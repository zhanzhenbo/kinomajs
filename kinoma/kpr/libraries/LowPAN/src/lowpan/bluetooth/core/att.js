//@module
/*
 *     Copyright (C) 2010-2016 Marvell International Ltd.
 *     Copyright (C) 2002-2010 Kinoma, Inc.
 *
 *     Licensed under the Apache License, Version 2.0 (the "License");
 *     you may not use this file except in compliance with the License.
 *     You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *     Unless required by applicable law or agreed to in writing, software
 *     distributed under the License is distributed on an "AS IS" BASIS,
 *     WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *     See the License for the specific language governing permissions and
 *     limitations under the License.
 */

/**
 * Kinoma LowPAN Framework: Kinoma Bluetooth Stack
 * Bluetooth v4.2 - Attribute Protocol (ATT)
 */

var Utils = require("/lowpan/common/utils");
var Logger = Utils.Logger;
var Buffers = require("/lowpan/common/buffers");
var ByteBuffer = Buffers.ByteBuffer;

var BTUtils = require("btutils");
var UUID = BTUtils.UUID;

var logger = new Logger("ATT");
logger.loggingLevel = Utils.Logger.Level.INFO;

var MIN_HANDLE = 0x0001;
var MAX_HANDLE = 0xFFFF;
var INVALID_HANDLE = 0x0000;

exports.MIN_HANDLE = MIN_HANDLE;
exports.MAX_HANDLE = MAX_HANDLE;
exports.INVALID_HANDLE = INVALID_HANDLE;

var ATT_MTU = 23;
exports.ATT_MTU = ATT_MTU;

/**
 * ATT Opcode
 */
var Opcode = {
	COMMAND: 0x40,
	SIGNED: 0x80,
	ERROR_RESPONSE: 0x01,
	EXCHANGE_MTU_REQUEST: 0x02,
	EXCHANGE_MTU_RESPONSE: 0x03,
	FIND_INFORMATION_REQUEST: 0x04,
	FIND_INFORMATION_RESPONSE: 0x05,
	FIND_BY_TYPE_VALUE_REQUEST: 0x06,
	FIND_BY_TYPE_VALUE_RESPONSE: 0x07,
	READ_BY_TYPE_REQUEST: 0x08,
	READ_BY_TYPE_RESPONSE: 0x09,
	READ_REQUEST: 0x0A,
	READ_RESPONSE: 0x0B,
	READ_BLOB_REQUEST: 0x0C,
	READ_BLOB_RESPONSE: 0x0D,
	READ_MULTIPLE_REQUEST: 0x0E,
	READ_MULTIPLE_RESPONSE: 0x0F,
	READ_BY_GROUP_TYPE_REQUEST: 0x10,
	READ_BY_GROUP_TYPE_RESPONSE: 0x11,
	WRITE_REQUEST: 0x12,
	WRITE_RESPONSE: 0x13,
	WRITE_COMMAND: 0x52,
	SIGNED_WRITE_COMMAND: 0xD2,
	PREPARE_WRITE_REQUEST: 0x16,
	PREPARE_WRITE_RESPONSE: 0x17,
	EXECUTE_WRITE_REQUEST: 0x18,
	EXECUTE_WRITE_RESPONSE: 0x19,
	HANDLE_VALUE_NOTIFICATION: 0x1B,
	HANDLE_VALUE_INDICATION: 0x1D,
	HANDLE_VALUE_CONFIRMATION: 0x1E,
	isResponse: function (opcode) {
	switch (opcode) {
		case Opcode.ERROR_RESPONSE:
		case Opcode.EXCHANGE_MTU_RESPONSE:
		case Opcode.FIND_INFORMATION_RESPONSE:
		case Opcode.FIND_BY_TYPE_VALUE_RESPONSE:
		case Opcode.READ_BY_TYPE_RESPONSE:
		case Opcode.READ_RESPONSE:
		case Opcode.READ_BLOB_RESPONSE:
		case Opcode.READ_MULTIPLE_RESPONSE:
		case Opcode.READ_BY_GROUP_TYPE_RESPONSE:
		case Opcode.WRITE_RESPONSE:
		case Opcode.PREPARE_WRITE_RESPONSE:
		case Opcode.EXECUTE_WRITE_RESPONSE:
			return true;
		default:
			return false;
		}
	}
};
exports.Opcode = Opcode;

/**
 * ATT Error Code
 * (3.4.1.1 Error Response)
 */
var ErrorCode = {
	INVALID_HANDLE: 0x01,
	READ_NOT_PERMITTED: 0x02,
	WRITE_NOT_PERMITTED: 0x03,
	INVALID_PDU: 0x04,
	INSUFFICIENT_AUTHENTICATION: 0x05,
	REQUEST_NOT_SUPPORTED: 0x06,
	ATTRIBUTE_NOT_FOUND: 0x0A,
	INSUFFICIENT_ENCRYPTION: 0x0F,
	UNSUPPORTED_GROUP_TYPE: 0x10
};
exports.ErrorCode = ErrorCode;

var Status = {
	error: function (errorCode, attributeHandle) {
		return {code: errorCode, handle: attributeHandle};
	},
	success: function () {
		return {code: 0};
	}
};

var responseReader = {};
var requestHandler = {};
var commandHandler = {};

var supportedGroups = [];

exports.setSupportedGroups = function (groups) {
	supportedGroups = groups;
};

function isGroupSupported(type) {
	for (var i = 0; i < supportedGroups.length; i++) {
		if (supportedGroups[i].equals(type)) {
			return true;
		}
	}
	return false;
}

/**
 * A class represents attribute
 */
class Attribute {
	constructor(type, value) {
		this.type = type;
		if (value === undefined) {
			this.value = null;
		} else {
			this.value = value;
		}
		this.handle = INVALID_HANDLE;
		this.groupEnd = INVALID_HANDLE;
		this.callback = {
			onHandleAssigned: null,
			onRead: null,
			onWrite: null
		};
		this.permission = {
			readable: false,
			writable: false,
			commandable: false,
			authentication: false,
			authorization: false
		};
	}
	assignHandle(handle) {
		this.handle = handle;
		if (this.callback.onHandleAssigned != null) {
			this.callback.onHandleAssigned(this, handle);
		}
	}
	isGroup() {
		return this.groupEnd != INVALID_HANDLE;
	}
	readValue(context) {
		if (this.callback.onRead != null) {
			this.callback.onRead(this, context);
		}
		return this.value;
	}
	writeValue(value, context) {
		if (this.callback.onWrite != null) {
			this.callback.onWrite(this, value, context);
		}
		this.value = value;
	}
}

/**
 * A class represents attributes database
 */
class AttributeDatabase {
	constructor(attributes) {
		if (attributes === undefined) {
			this.attributes = [{}];
			this.currentHandle = MIN_HANDLE;
		} else {
			this.attributes = attributes;
			this.currentHandle = attributes.length;
		}
	}
	allocateAttribute(type, value) {
		let attribute = new Attribute(type, value);
		this.attributes[this.currentHandle] = attribute;
		this.currentHandle++;
		return attribute;
	}
	addAttribute(attribute) {
		this.attributes[this.currentHandle] = attribute;
		this.currentHandle++;
		return attribute;
	}
	assignHandles() {
		for (let handle = MIN_HANDLE; handle < this.attributes.length; handle++) {
			let attribute = this.attributes[handle];
			if (attribute.handle != INVALID_HANDLE) {
				// Do not reassign
				continue;
			}
			attribute.assignHandle(handle);
		}
	}
	getEndHandle(handle) {
		return this.currentHandle - 1;
	}
	findAttribute(handle) {
		logger.debug("[DB] Find Attribute:"
			+ "handle=" + Utils.toHexString(handle, 2)
		);
		return (handle > this.getEndHandle()) ? null : this.attributes[handle];
	}
	findAttributes(start, end) {
		logger.debug("[DB] Find Attributes:"
			+ "start=" + Utils.toHexString(start, 2)
			+ ", end=" + Utils.toHexString(end, 2)
		);
		let endHandle = this.getEndHandle();
		if (start > endHandle) {
			return [];
		}
		if (start == end) {
			return [this.attributes[start]];
		} else {
			if (end > endHandle) {
				end = endHandle;
			}
			let results = [this.attributes[start]];
			let format16 = results[0].type.isUUID16();
			for (let handle = (start + 1); handle <= end; handle++) {
				let attribute = this.attributes[handle];
				if (format16 != attribute.type.isUUID16()) {
					break;
				}
				results.push(attribute);
			}
			return results;
		}
	}
	findAttributesByTypeValue(start, end, type, value) {
		logger.debug("[DB] Find Attributes By Type Value:"
			+ "start=" + Utils.toHexString(start, 2)
			+ ", end=" + Utils.toHexString(end, 2)
			+ ", type=" + type.toString()
			+ ", value=" + Utils.toFrameString(value)
		);	
		return this._findAttributes(start, end, type, value, false);
	}
	findAttributesByType(start, end, type) {
		logger.debug("[DB] Find Attributes By Type:"
			+ "start=" + Utils.toHexString(start, 2)
			+ ", end=" + Utils.toHexString(end, 2)
			+ ", type=" + type.toString()
		);
		return this._findAttributes(start, end, type, null, false);
	}
	findAttributesByGroupType(start, end, type) {
		logger.debug("[DB] Find Attributes By Group Type:"
			+ "start=" + Utils.toHexString(start, 2)
			+ ", end=" + Utils.toHexString(end, 2)
			+ ", type=" + type.toString()
		);
		return this._findAttributes(start, end, type, null, true);
	}
	_findAttributes(start, end, type, value, group) {
		let endHandle = this.getEndHandle();
		let results = [];
		if (start > endHandle) {
			return results;
		}
		if (end > endHandle) {
			end = endHandle;
		}
		for (let handle = start; handle <= end; handle++) {
			let attribute = this.attributes[handle];
			if (!attribute.type.equals(type)) {
				continue;
			}
			if (value != null && !BTUtils.isArrayEquals(attribute.readValue(), value)) {
				continue;
			}
			if (group && !attribute.isGroup()) {
				continue;
			}
			results.push(attribute);
		}
		logger.debug("[DB] Attributes Found: " + results.length);
		return results;
	}
}
exports.AttributeDatabase = AttributeDatabase;

/**
 * A class represents ATT Bearer
 */
class ATTBearer {
	constructor(connection, database) {
		this.mtu = ATT_MTU;
		this.pendingTransactions = [];
		this.connection = connection;
		this._database = database;
		this.delegate = null;
		connection.delegate = this;
	}
	get database() {
		return this._database;
	}
	getHCILinkHandle() {
		return this.connection.getHCILink().handle;
	}
	allocateBuffer() {
		// Allocate ByteBuffer capacity=mtu, littleEndian=true
		return ByteBuffer.allocateUint8Array(this.mtu, true);
	}
	scheduleTransaction(pdu, callback) {
		logger.debug("[Bearer] scheduleTransaction: PDULen=" + pdu.length +
			" currentMTU=" + this.mtu);
		// Enqueue
		// TODO: Check MTU
		// TODO: 30sec Timeout
		this.pendingTransactions.push({
			opcode: pdu[0],
			pdu: pdu,
			callback: callback,
			sent: false
		});
		if (this.pendingTransactions.length == 1) {
			// Send immediately
			this.sendCurrentPDU();
		}
	}
	/**
	 * Send PDU without flow control. (i.e. Notifications or Commands)
	 */
	sendPDU(pdu) {
		if (this.connection == null) {
			throw "Connection has been disconnected";
		}
		this.connection.sendBasicFrame(pdu);
	}
	sendCurrentPDU() {
		let transaction = this.pendingTransactions[0];
		if (!transaction.sent) {
			this.sendPDU(transaction.pdu);
			transaction.sent = true;
		}
	}
	errorReceived(requestOpcode, handle, errorCode) {
		if (this.pendingTransactions.length == 0) {
			// No pending transaction
			logger.debug("Error received but no pending transactions: "
				+ Utils.toHexString(requestOpcode)
				+ ", error=" + Utils.toHexString(errorCode));
			return;
		}
		if (this.pendingTransactions[0].opcode != requestOpcode) {
			// Not a valid error response
			logger.debug("Error received but not a valid response: "
				+ Utils.toHexString(requestOpcode)
				+ ", error=" + Utils.toHexString(errorCode));
			return;
		}
		let transaction = this.pendingTransactions.shift();
		if (transaction.callback != null) {
			transaction.callback.transactionCompleteWithError(errorCode, handle);
		}
		if (this.pendingTransactions.length > 0) {
			this.sendCurrentPDU();
		}
	}
	responseReceived(opcode, response) {
		if (this.pendingTransactions.length == 0) {
			// No pending transaction
			logger.debug("Response received but no pending transactions: " +
				Utils.toHexString(opcode));
			return;
		}
		let transaction = this.pendingTransactions.shift();
		if (transaction.callback != null) {
			transaction.callback.transactionCompleteWithResponse(opcode, response);
		}
		if (this.pendingTransactions.length > 0) {
			this.sendCurrentPDU();
		}
	}
	/** L2CAP Connection delegate method */
	received(buffer) {
		let opcode = buffer.getInt8();
		logger.debug("ATT Received: opcode=" + Utils.toHexString(opcode));
		if ((opcode & Opcode.SIGNED) > 0) {
			// TODO
			logger.warn("Signed Command Not Supported");
			return;
		}
		if (Opcode.isResponse(opcode) || opcode == Opcode.HANDLE_VALUE_CONFIRMATION) {
			/* Responses or Confirmations */
			if (opcode == Opcode.ERROR_RESPONSE) {
				let requestOpcode = buffer.getInt8();
				let handle = buffer.getInt16();
				let errorCode = buffer.getInt8();
				if (!Opcode.isResponse(requestOpcode)) {
					this.errorReceived(requestOpcode, handle, errorCode);
				} else {
					logger.info(
						"Error Response: request=" + Utils.toHexString(requestOpcode) +
						", handle=" + Utils.toHexString(handle, 2) +
						", errorCode=" + Utils.toHexString(errorCode)
					);
				}
			} else {
				let response = null;
				if (buffer.remaining() > 0) {
					if (opcode in responseReader) {
						response = responseReader[opcode](buffer);
					} else {
						logger.warn("Response Not Supported");
					}
				}
				this.responseReceived(opcode, response);
			}
		} else if (((opcode & Opcode.COMMAND) > 0) || opcode == Opcode.HANDLE_VALUE_NOTIFICATION) {
			/* Commands and Notifications */
			if (!(opcode in commandHandler)) {
				logger.warn("Command Not Supported");
			} else {
				commandHandler[opcode](buffer, this);
			}
		} else {
			/* Requests or Indications */
			let respBuffer = this.allocateBuffer();
			let status = null;
			respBuffer.mark();
			if (!(opcode in requestHandler)) {
				logger.warn("Request Not Supported");
				status = Status.error(ErrorCode.REQUEST_NOT_SUPPORTED, 0);
			} else {
				status = requestHandler[opcode](buffer, respBuffer, this);
			}
			if (status != null && status.code != 0) {
				logger.debug("Response with Error: opcode=" + Utils.toHexString(opcode)
					+ ", handle=" + Utils.toHexString(status.handle, 2)
					+ ", code=" + Utils.toHexString(status.code));
				respBuffer.reset();
				respBuffer.putInt8(Opcode.ERROR_RESPONSE);
				respBuffer.putInt8(opcode);
				respBuffer.putInt16(status.handle);
				respBuffer.putInt8(status.code);
			}
			if (respBuffer.getPosition() > 0) {
				respBuffer.flip();
				/* We don't need flow control here */
				this.sendPDU(respBuffer.getByteArray());
			}
		}
	}
	/** L2CAP Connection delegate method */
	disconnected() {
		logger.info("Disconnected: pendingPDUs=" + this.pendingTransactions.length);
		this.connection = null;
	}
}
exports.ATTBearer = ATTBearer;

/******************************************************************************
 * ExchangeMTU Request/Response
 ******************************************************************************/

responseReader[Opcode.EXCHANGE_MTU_RESPONSE] = function (buffer) {
	return {
		mtu: buffer.getInt16()
	};
};

requestHandler[Opcode.EXCHANGE_MTU_REQUEST] = function (request, response, bearer) {
	var clientMTU = request.getInt16();
	logger.debug("Exchange MTU Request: Client MTU=" + clientMTU);
	response.putInt8(Opcode.EXCHANGE_MTU_RESPONSE);
	response.putInt16(bearer.mtu);
	if (clientMTU < bearer.mtu) {
		logger.debug("Exchange MTU Request: Change MTU to " + clientMTU);
		bearer.mtu = clientMTU;
	}
};

exports.assembleExchangeMTURequestPDU = function (mtu) {
	var buffer = ByteBuffer.allocateUint8Array(3, true);
	buffer.putInt8(Opcode.EXCHANGE_MTU_REQUEST);
	buffer.putInt16(mtu);
	buffer.flip();
	return buffer.getByteArray();
};

/******************************************************************************
 * FindInformation Request/Response
 ******************************************************************************/

responseReader[Opcode.FIND_INFORMATION_RESPONSE] = function (buffer) {
	var attributes = [];
	var format = buffer.getInt8();
	var uuidSize = (format == 0x01) ? 2 : 16;
	while (buffer.remaining() > 0) {
		attributes.push({
			handle: buffer.getInt16(),
			type: UUID.getByUUID(buffer.getByteArray(uuidSize))
		});
	}
	return attributes;
};

requestHandler[Opcode.FIND_INFORMATION_REQUEST] = function (request, response, bearer) {
	var start = request.getInt16();
	var end = request.getInt16();
	if ((start > end) || start == INVALID_HANDLE) {
		return Status.error(ErrorCode.INVALID_HANDLE, start);
	}
	var attributes = bearer.database.findAttributes(start, end);
	if (attributes.length == 0) {
		return Status.error(ErrorCode.ATTRIBUTE_NOT_FOUND, start);
	}
	response.putInt8(Opcode.FIND_INFORMATION_RESPONSE);
	var format = attributes[0].type.isUUID16() ? 0x01 : 0x02;
	var infoSize = 2 + (format == 0x01) ? 2 : 16;
	response.putInt8(format);
	for (var index = 0; index < attributes.length; index++) {
		if (response.remaining() < infoSize) {
			break;	// Stop response here
		}
		var attribute = attributes[index];
		response.putInt16(attribute.handle);
		response.putByteArray(attribute.type.getRawArray());
	}
	return Status.success();
};

exports.assembleFindInformationRequestPDU = function (start, end) {
	var buffer = ByteBuffer.allocateUint8Array(5, true);
	buffer.putInt8(Opcode.FIND_INFORMATION_REQUEST);
	buffer.putInt16(start);
	buffer.putInt16(end);
	buffer.flip();
	return buffer.getByteArray();
};

/******************************************************************************
 * FindByType Request/Response
 ******************************************************************************/

responseReader[Opcode.FIND_BY_TYPE_VALUE_RESPONSE] = function (buffer) {
	var attributes = [];
	while (buffer.remaining() > 0) {
		attributes.push({
			handle: buffer.getInt16(),
			groupEnd: buffer.getInt16()
		});
	}
	return attributes;
};

requestHandler[Opcode.FIND_BY_TYPE_VALUE_REQUEST] = function (request, response, bearer) {
	var start = request.getInt16();
	var end = request.getInt16();
	if ((start > end) || start == INVALID_HANDLE) {
		return Status.error(ErrorCode.INVALID_HANDLE, start);
	}
	var type = UUID.getByUUID(request.getByteArray(2));
	var value = request.getByteArray();
	var attributes = bearer.database.findAttributesByTypeValue(start, end, type, value);
	if (attributes.length == 0) {
		return Status.error(ErrorCode.ATTRIBUTE_NOT_FOUND, start);
	}
	response.putInt8(Opcode.FIND_BY_TYPE_VALUE_RESPONSE);
	for (var index = 0; index < attributes.length; index++) {
		if (response.remaining() < 4) {
			break;	// Stop response here
		}
		var attribute = attributes[index];
		response.putInt16(attribute.handle);
		response.putInt16(attribute.isGroup() ? attribute.groupEnd : attribute.handle);
	}
	return Status.success();
};

exports.assembleFindByTypeValueRequestPDU = function (start, end, type, value) {
	var buffer = ByteBuffer.allocateUint8Array(7 + value.length, true);
	buffer.putInt8(Opcode.FIND_BY_TYPE_VALUE_REQUEST);
	buffer.putInt16(start);
	buffer.putInt16(end);
	if (!type.isUUID16()) {
		throw "Type is not UUID16";
	}
	buffer.putInt16(type.toUUID16());
	buffer.putByteArray(value);
	buffer.flip();
	return buffer.getByteArray();
};

/******************************************************************************
 * ReadByType Request/Response
 ******************************************************************************/

requestHandler[Opcode.READ_BY_TYPE_REQUEST] = function (request, response, bearer) {
	return doReadByTypeResponse(request, response, bearer, false);
};

requestHandler[Opcode.READ_BY_GROUP_TYPE_REQUEST] = function (request, response, bearer) {
	return doReadByTypeResponse(request, response, bearer, true);
};

responseReader[Opcode.READ_BY_TYPE_RESPONSE] = function (buffer) {
	return readReadByTypeResponse(buffer, false);
};

responseReader[Opcode.READ_BY_GROUP_TYPE_RESPONSE] = function (buffer) {
	return readReadByTypeResponse(buffer, true);
};

/**
 * Do ReadByType or ReadByGroupType
 * ReadByType:			group=false
 * ReadByGroupType:		group=true
 */
function doReadByTypeResponse(request, response, bearer, group) {
	var start = request.getInt16();
	var end = request.getInt16();
	if ((start > end) || start == INVALID_HANDLE) {
		return Status.error(ErrorCode.INVALID_HANDLE, start);
	}
	var type = UUID.getByUUID(request.getByteArray());
	var attributes;
	if (group) {
		if (!isGroupSupported(type)) {
			return Status.error(ErrorCode.UNSUPPORTED_GROUP_TYPE, start);
		}
		attributes = bearer.database.findAttributesByGroupType(start, end, type);
	} else {
		attributes = bearer.database.findAttributesByType(start, end, type);
	}
	if (attributes.length == 0) {
		return Status.error(ErrorCode.ATTRIBUTE_NOT_FOUND, start);
	}
	var valueSize = -1;
	var results = [];
	for (var index = 0; index < attributes.length; index++) {
		var attribute = attributes[index];
		if (!attribute.permission.readable) {
			break;
		}
		var value = attribute.readValue({request: request, bearer: bearer});
		if (valueSize < 0) {
			valueSize = value.length;
		} else if (valueSize != value.length) {
			break;
		}
		var result = {
			handle: attribute.handle,
			value: value
		};
		if (group) {
			result.endGroupHandle = attribute.groupEnd;
		}
		results.push(result);
	}
	if (results.length == 0) {
		return Status.error(ErrorCode.READ_NOT_PERMITTED, start);
	}
	var keySize = (group ? 4 : 2);
	var actualLength = (keySize + valueSize) & 0xFF;
	var actualValueSize = actualLength - keySize;
	response.putInt8(group ? Opcode.READ_BY_GROUP_TYPE_RESPONSE : Opcode.READ_BY_TYPE_RESPONSE);
	response.putInt8(actualLength);
	for (var index = 0; index < results.length; index++) {
		/*
		 * The reason here we omit the case index == 0 is to guarantee that at least 1 complete
		 * handle-value pair is included in the response.
		 */
		if ((index != 0) && (response.remaining() < actualLength)) {
			// Stop response here
			break;
		}
		var result = results[index];
		response.putInt16(result.handle);
		if (group) {
			response.putInt16(result.endGroupHandle);
		}
		response.putByteArray(result.value, 0, Math.min(response.remaining(), actualValueSize));
	}
	return Status.success();
}

function readReadByTypeResponse(buffer, group) {
	var attributes = [];
	var length = buffer.getInt8();
	while (buffer.remaining() > 0) {
		var attribute = {};
		attribute.handle = buffer.getInt16();
		if (group) {
			attribute.groupEnd = buffer.getInt16();
		}
		attribute.value = buffer.getByteArray(length - (group ? 4 : 2));
		attributes.push(attribute);
	}
	return attributes;
}

/**
 * Send ReadByType or ReadByGroupType
 * ReadByType:			group=false
 * ReadByGroupType:		group=true
 */
function assembleReadByTypeRequestPDU0(start, end, type, group) {
	var typeArray = type.getRawArray();
	var buffer = ByteBuffer.allocateUint8Array(5 + typeArray.length, true);
	buffer.putInt8(group ? Opcode.READ_BY_GROUP_TYPE_REQUEST : Opcode.READ_BY_TYPE_REQUEST);
	buffer.putInt16(start);
	buffer.putInt16(end);
	buffer.putByteArray(typeArray);
	buffer.flip();
	return buffer.getByteArray();
}

exports.assembleReadByTypeRequestPDU = function (start, end, type) {
	return assembleReadByTypeRequestPDU0(start, end, type, false);
};

exports.assembleReadByGroupTypeRequestPDU = function (start, end, type) {
	return assembleReadByTypeRequestPDU0(start, end, type, true);
};

/******************************************************************************
 * Read (Single)/Blob/Multiple Request/Response
 ******************************************************************************/

requestHandler[Opcode.READ_REQUEST] = function (request, response, bearer) {
	return doReadResponse(request, response, bearer, false);
};

requestHandler[Opcode.READ_BLOB_REQUEST] = function (request, response, bearer) {
	return doReadResponse(request, response, bearer, true);
};

requestHandler[Opcode.READ_MULTIPLE_REQUEST] = function (request, response, bearer) {
	response.putInt8(Opcode.READ_MULTIPLE_RESPONSE);
	while (request.remaining() > 0 && response.remaining() > 0) {
		var handle = request.getInt16();
		if (handle == INVALID_HANDLE) {
			return Status.error(ErrorCode.INVALID_HANDLE, handle);
		}
		var attribute = bearer.database.findAttribute(handle);
		if (attribute == null) {
			return Status.error(ErrorCode.INVALID_HANDLE, handle);
		}
		if (!attribute.permission.readable) {
			return Status.error(ErrorCode.READ_NOT_PERMITTED, handle);
		}
		var valueToRsp = attribute.readValue({request: request, bearer: bearer});
		response.putByteArray(valueToRsp, 0,
			Math.min(response.remaining(), valueToRsp.length));
	}
	return Status.success();
};

responseReader[Opcode.READ_RESPONSE] = function (buffer) {
	return buffer.getByteArray();
};
responseReader[Opcode.READ_BLOB_RESPONSE] = responseReader[Opcode.READ_RESPONSE];
responseReader[Opcode.READ_MULTIPLE_RESPONSE] = responseReader[Opcode.READ_RESPONSE];

/*
 * Do ReadRequest or ReadBlobRequest
 */
function doReadResponse(request, response, bearer, blob) {
	var handle = request.getInt16();
	var offset = 0;
	if (blob) {
		offset = request.getInt16();
	}
	if (handle == INVALID_HANDLE) {
		return Status.error(ErrorCode.INVALID_HANDLE, handle);
	}
	var attribute = bearer.database.findAttribute(handle);
	if (attribute == null) {
		return Status.error(ErrorCode.INVALID_HANDLE, handle);
	}
	if (!attribute.permission.readable) {
		return Status.error(ErrorCode.READ_NOT_PERMITTED, handle);
	}
	var value = attribute.readValue({request: request, bearer: bearer});
	if (blob && offset >= value.length) {
		return Status.error(ErrorCode.INVALID_OFFSET, handle);
	}
	response.putInt8(blob ? Opcode.READ_BLOB_RESPONSE : Opcode.READ_RESPONSE);
	var valueToRsp = blob ? value.slice(offset) : value;
	response.putByteArray(valueToRsp, 0,
		Math.min(response.remaining(), valueToRsp.length));
	return Status.success();
}

exports.assembleReadRequestPDU = function (handle) {
	var buffer = ByteBuffer.allocateUint8Array(3, true);
	buffer.putInt8(Opcode.READ_REQUEST);
	buffer.putInt16(handle);
	buffer.flip();
	return buffer.getByteArray();
};

exports.assembleReadBlobRequestPDU = function (handle, offset) {
	var buffer = ByteBuffer.allocateUint8Array(5, true);
	buffer.putInt8(Opcode.READ_BLOB_REQUEST);
	buffer.putInt16(handle);
	buffer.putInt16(offset);
	buffer.flip();
	return buffer.getByteArray();
};

exports.assembleReadMultipleRequestPDU = function (handles) {
	var buffer = ByteBuffer.allocateUint8Array(handles.length * 2, true);
	buffer.putInt8(Opcode.READ_MULTIPLE_REQUEST);
	for (var i = 0; i < handles.length; i++) {
		buffer.putInt16(handles[i]);
	}
	buffer.flip();
	return buffer.getByteArray();
};

/******************************************************************************
 * Write Request/Response
 ******************************************************************************/

requestHandler[Opcode.WRITE_REQUEST] = function (request, response, bearer) {
	var handle = request.getInt16();
	if (handle == INVALID_HANDLE) {
		return Status.error(ErrorCode.INVALID_HANDLE, handle);
	}
	var attribute = bearer.database.findAttribute(handle);
	if (attribute == null) {
		return Status.error(ErrorCode.INVALID_HANDLE, handle);
	}
	if (!attribute.permission.writable) {
		return Status.error(ErrorCode.WRITE_NOT_PERMITTED, handle);
	}
	// TODO: Invalid Length
	attribute.writeValue(request.getByteArray(), {request: request, bearer: bearer});
	response.putInt8(Opcode.WRITE_RESPONSE);
	return Status.success();
};

responseReader[Opcode.WRITE_RESPONSE] = null;

exports.assembleWriteRequestPDU = function (handle, value) {
	var buffer = ByteBuffer.allocateUint8Array(3 + value.length, true);
	buffer.putInt8(Opcode.WRITE_REQUEST);
	buffer.putInt16(handle);
	buffer.putByteArray(value);
	buffer.flip();
	return buffer.getByteArray();
};

/******************************************************************************
 * Write Command
 ******************************************************************************/

commandHandler[Opcode.WRITE_COMMAND] = function (command, bearer) {
	var handle = command.getInt16();
	if (handle == INVALID_HANDLE) {
		logger.warn("Write Command failed: Invalid handle");
		return;
	}
	var attribute = bearer.database.findAttribute(handle);
	if (attribute == null) {
		logger.warn("Write Command failed: Handle not found");
		return;
	}
	if (!attribute.permission.commandable) {
		logger.warn("Write Command failed: Not commandable");
		return;
	}
	// TODO: Invalid Length
	attribute.writeValue(command.getByteArray(), {request: request, bearer: bearer});
};

exports.assembleWriteCommandPDU = function (handle, value) {
	var buffer = ByteBuffer.allocateUint8Array(3 + value.length, true);
	buffer.putInt8(Opcode.WRITE_COMMAND);
	buffer.putInt16(handle);
	buffer.putByteArray(value);
	buffer.flip();
	return buffer.getByteArray();
};

/******************************************************************************
 * HandleValue Notification
 ******************************************************************************/

commandHandler[Opcode.HANDLE_VALUE_NOTIFICATION] = function (command, bearer) {
	if (bearer.delegate != null) {
		bearer.delegate.notificationReceived(Opcode.HANDLE_VALUE_NOTIFICATION, {
			handle: command.getInt16(),
			value: command.getByteArray()
		});
	}
};

exports.assembleHandleValueNotificationPDU = function (handle, value) {
	var buffer = ByteBuffer.allocateUint8Array(3 + value.length, true);
	buffer.putInt8(Opcode.HANDLE_VALUE_NOTIFICATION);
	buffer.putInt16(handle);
	buffer.putByteArray(value);
	buffer.flip();
	return buffer.getByteArray();
};

/******************************************************************************
 * HandleValue Indication/Confirmation
 ******************************************************************************/

requestHandler[Opcode.HANDLE_VALUE_INDICATION] = function (request, response, bearer) {
	if (bearer.delegate != null) {
		bearer.delegate.indicationReceived(Opcode.HANDLE_VALUE_INDICATION, {
			handle: request.getInt16(),
			value: request.getByteArray()
		});
	}
	response.putInt8(Opcode.HANDLE_VALUE_CONFIRMATION);
	return null;
};

responseReader[Opcode.HANDLE_VALUE_CONFIRMATION] = null;

exports.assembleHandleValueIndicationPDU = function (handle, value) {
	var buffer = ByteBuffer.allocateUint8Array(3 + value.length, true);
	buffer.putInt8(Opcode.HANDLE_VALUE_INDICATION);
	buffer.putInt16(handle);
	buffer.putByteArray(value);
	buffer.flip();
	return buffer.getByteArray();
};
