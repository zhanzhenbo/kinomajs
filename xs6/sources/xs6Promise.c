/*
 *     Copyright (C) 2010-2015 Marvell International Ltd.
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
#include "xs6All.h"

#define mxIsPromise(THE_SLOT) \
	((THE_SLOT) &&  ((THE_SLOT)->flag & XS_VALUE_FLAG) && ((THE_SLOT)->next->kind == XS_PROMISE_KIND))

#define mxPromiseStatus(INSTANCE) ((INSTANCE)->next)
#define mxPromiseThens(INSTANCE) ((INSTANCE)->next->next)
#define mxPromiseResult(INSTANCE) ((INSTANCE)->next->next->next)
#define mxPromiseFulfillCallback(INSTANCE) ((INSTANCE)->next->next->next->next)
#define mxPromiseRejectCallback(INSTANCE) ((INSTANCE)->next->next->next->next->next)

enum {
	mxUndefinedStatus,
	mxPendingStatus,
	mxFulfilledStatus,
	mxRejectedStatus
};

static txSlot* fxNewPromiseAlready(txMachine* the);
static txSlot* fxNewPromiseFunction(txMachine* the, txSlot* already, txSlot* promise, txSlot* function);
static txSlot* fxNewPromiseFunctionAll(txMachine* the, txSlot* already, txSlot* array, txInteger index, txSlot* count, txSlot* promise, txSlot* function);
static void fxCallPromise(txMachine* the);
static void fxCallPromiseAll(txMachine* the);
static void fxOnRejectedPromise(txMachine* the);
static void fxOnResolvedPromise(txMachine* the);
static void fxRejectPromise(txMachine* the);
static void fxResolvePromise(txMachine* the);
static void fx_Promise(txMachine* the);
static void fx_Promise_all(txMachine* the);
static void fx_Promise_race(txMachine* the);
static void fx_Promise_reject(txMachine* the);
static void fx_Promise_resolve(txMachine* the);
static void fx_Promise_prototype_catch(txMachine* the);
static void fx_Promise_prototype_then(txMachine* the);
static void fxQueueJob(txMachine* the, txID id);

void fxBuildPromise(txMachine* the)
{
    static const txHostFunctionBuilder gx_Promise_prototype_builders[] = {
		{ fx_Promise_prototype_catch, 1, _catch },
		{ fx_Promise_prototype_then, 2, _then },
		{ C_NULL, 0, 0 },
    };
    static const txHostFunctionBuilder gx_Promise_builders[] = {
		{ fx_Promise_all, 1, _all },
		{ fx_Promise_race, 1, _race },
		{ fx_Promise_reject, 1, _reject },
		{ fx_Promise_resolve, 1, _resolve },
		{ C_NULL, 0, 0 },
    };
    const txHostFunctionBuilder* builder;
	txSlot* slot;
	mxPush(mxObjectPrototype);
	slot = fxLastProperty(the, fxNewPromiseInstance(the));
	for (builder = gx_Promise_prototype_builders; builder->callback; builder++)
		slot = fxNextHostFunctionProperty(the, slot, builder->callback, builder->length, mxID(builder->id), XS_DONT_ENUM_FLAG);
	slot = fxNextStringProperty(the, slot, "Promise", mxID(_Symbol_toStringTag), XS_DONT_ENUM_FLAG | XS_DONT_SET_FLAG);
	mxPromisePrototype = *the->stack;
	slot = fxLastProperty(the, fxNewHostConstructorGlobal(the, fx_Promise, 2, mxID(_Promise), XS_GET_ONLY));
	for (builder = gx_Promise_builders; builder->callback; builder++)
		slot = fxNextHostFunctionProperty(the, slot, builder->callback, builder->length, mxID(builder->id), XS_DONT_ENUM_FLAG);
	slot = fxNextHostAccessorProperty(the, slot, fx_species_get, C_NULL, mxID(_Symbol_species), XS_DONT_ENUM_FLAG);
	the->stack++;
	fxNewHostFunction(the, fxOnRejectedPromise, 1, XS_NO_ID);
	mxOnRejectedPromiseFunction = *the->stack;
	the->stack++;
	fxNewHostFunction(the, fxOnResolvedPromise, 1, XS_NO_ID);
	mxOnResolvedPromiseFunction = *the->stack;
	the->stack++;
	fxNewHostFunction(the, fxRejectPromise, 1, XS_NO_ID);
	mxRejectPromiseFunction = *the->stack;
	the->stack++;
	fxNewHostFunction(the, fxResolvePromise, 1, XS_NO_ID);
	mxResolvePromiseFunction = *the->stack;
	the->stack++;
}

txSlot* fxNewPromiseInstance(txMachine* the)
{
	//static txID gID = -2;
	txSlot* promise;
	txSlot* slot;
	txSlot* instance;
	promise = fxNewSlot(the);
	promise->flag = XS_VALUE_FLAG;
	promise->kind = XS_INSTANCE_KIND;
	promise->value.instance.garbage = C_NULL;
	promise->value.instance.prototype = the->stack->value.reference;
	the->stack->kind = XS_REFERENCE_KIND;
	the->stack->value.reference = promise;
	/* STATUS */
	slot = promise->next = fxNewSlot(the);
	slot->flag = XS_DONT_DELETE_FLAG | XS_DONT_ENUM_FLAG | XS_DONT_SET_FLAG;
	//slot->ID = gID++;
	slot->kind = XS_PROMISE_KIND;
	slot->value.integer = mxUndefinedStatus;
	/* THENS */
	slot = slot->next = fxNewSlot(the);
	slot->flag = XS_DONT_DELETE_FLAG | XS_DONT_ENUM_FLAG | XS_DONT_SET_FLAG;
	slot->value.reference = instance = fxNewSlot(the);
    slot->kind = XS_REFERENCE_KIND;
	instance->kind = XS_INSTANCE_KIND;
	instance->value.instance.garbage = C_NULL;
	instance->value.instance.prototype = C_NULL;
	/* RESULT */
	slot = slot->next = fxNewSlot(the);
	slot->flag = XS_DONT_DELETE_FLAG | XS_DONT_ENUM_FLAG | XS_DONT_SET_FLAG;
	/* RESOLVE CALLBACK */
	slot = slot->next = fxNewSlot(the);
	slot->flag = XS_DONT_DELETE_FLAG | XS_DONT_ENUM_FLAG | XS_DONT_SET_FLAG;
	/* REJECT CALLBACK */
	slot = slot->next = fxNewSlot(the);
	slot->flag = XS_DONT_DELETE_FLAG | XS_DONT_ENUM_FLAG | XS_DONT_SET_FLAG;
	//fprintf(stderr, "fxNewPromiseInstance %d\n", promise->next->ID);
	return promise;
}

txSlot* fxNewPromiseAlready(txMachine* the)
{
	txSlot* result;
	mxPushUndefined();
	result = the->stack->value.closure = fxNewSlot(the);
	the->stack->kind = XS_CLOSURE_KIND;
	result->kind = XS_BOOLEAN_KIND;
	result->value.boolean = 0;
	return result;
}

txSlot* fxNewPromiseFunction(txMachine* the, txSlot* already, txSlot* promise, txSlot* function)
{
	txSlot* result;
	txSlot* closures;
	txSlot* slot;
	result = fxNewHostFunction(the, fxCallPromise, 1, XS_NO_ID);
	closures = fxNewInstance(the);
	slot = closures->next = fxNewSlot(the);
	slot->kind = XS_CLOSURE_KIND;
	slot->value.closure = already;
	slot = slot->next = fxNewSlot(the);
	slot->kind = XS_REFERENCE_KIND;
	slot->value.reference = promise;
	slot = slot->next = fxNewSlot(the);
	slot->kind = XS_REFERENCE_KIND;
	slot->value.reference = function;
	slot = mxFunctionInstanceClosures(result);
	slot->kind = XS_REFERENCE_KIND;
	slot->value.reference = closures;
	the->stack++;
	return result;
}

txSlot* fxNewPromiseFunctionAll(txMachine* the, txSlot* already, txSlot* array, txInteger index, txSlot* count, txSlot* promise, txSlot* function)
{
	txSlot* result;
	txSlot* closures;
	txSlot* slot;
	result = fxNewHostFunction(the, fxCallPromiseAll, 1, XS_NO_ID);
	closures = fxNewInstance(the);
	slot = closures->next = fxNewSlot(the);
	slot->kind = XS_CLOSURE_KIND;
	slot->value.closure = already;
	slot = slot->next = fxNewSlot(the);
	slot->kind = XS_CLOSURE_KIND;
	slot->value.closure = array;
	slot = slot->next = fxNewSlot(the);
	slot->kind = XS_INTEGER_KIND;
	slot->value.integer = index;
	slot = slot->next = fxNewSlot(the);
	slot->kind = XS_CLOSURE_KIND;
	slot->value.closure = count;
	slot = slot->next = fxNewSlot(the);
	slot->kind = XS_REFERENCE_KIND;
	slot->value.reference = promise;
	slot = slot->next = fxNewSlot(the);
	slot->kind = XS_REFERENCE_KIND;
	slot->value.reference = function;
	slot = mxFunctionInstanceClosures(result);
	slot->kind = XS_REFERENCE_KIND;
	slot->value.reference = closures;
	the->stack++;
	return result;
}

void fxCallPromise(txMachine* the)
{
	txSlot* slot;
	slot = mxFunctionInstanceClosures(mxFunction->value.reference)->value.reference->next;
	if (slot->value.closure->value.boolean)
		return;
	slot->value.closure->value.boolean = 1;
	if (mxArgc > 0)
		mxPushSlot(mxArgv(0));
	else
		mxPushUndefined();
	/* COUNT */
	mxPushInteger(1);
	/* THIS */
	slot = slot->next;
	mxPushSlot(slot);
	/* FUNCTION */
	slot = slot->next;
	mxPushSlot(slot);
	fxCall(the);
	mxPullSlot(mxResult);
}

void fxCallPromiseAll(txMachine* the)
{
	txSlot* slot;
	txSlot* array;
	txSlot* count;
	slot = mxFunctionInstanceClosures(mxFunction->value.reference)->value.reference->next;
	if (slot->value.closure->value.boolean)
		return;
	slot->value.closure->value.boolean = 1;
    if (mxArgc > 0)
		mxPushSlot(mxArgv(0));
    else
        mxPushUndefined();
	slot = slot->next;
	array = slot->value.closure;
	mxPushSlot(array);
	slot = slot->next;
	mxPushSlot(slot);
	fxSetAt(the);
	the->stack++;
	slot = slot->next;
	count = slot->value.closure;
	count->value.integer--;
	if (count->value.integer == 0) {
		mxPushSlot(array);
		/* COUNT */
		mxPushInteger(1);
		/* THIS */
		slot = slot->next;
		mxPushSlot(slot);
		/* FUNCTION */
		slot = slot->next;
		mxPushSlot(slot);
		fxCall(the);
		mxPullSlot(mxResult);
	}
}

void fxOnRejectedPromise(txMachine* the)
{
	txSlot* promise = mxThis->value.reference;
	txSlot* argument = mxArgv(0);
	txSlot* function = &mxRejectPromiseFunction;
	txSlot* slot = mxPromiseRejectCallback(promise);
	//fprintf(stderr, "fxOnRejectedPromise %d\n", promise->next->ID);
	if (slot->kind == XS_REFERENCE_KIND) {
		mxTry(the) {
			mxPushSlot(argument);
			/* COUNT */
			mxPushInteger(1);
			/* THIS */
			mxPushUndefined();
			/* FUNCTION */
			mxPushSlot(slot);
			fxCall(the);
			mxPullSlot(argument);
			function = &mxResolvePromiseFunction;
		}
		mxCatch(the) {
			*argument = mxException;
		}
	}
	mxPushSlot(argument);
	/* COUNT */
	mxPushInteger(1);
	/* THIS */
	mxPushReference(promise);
	/* FUNCTION */
	mxPushSlot(function);
	fxCall(the);
	the->stack++;
}

void fxOnResolvedPromise(txMachine* the)
{
	txSlot* promise = mxThis->value.reference;
	txSlot* argument = mxArgv(0);
	txSlot* function = &mxResolvePromiseFunction;
	txSlot* slot = mxPromiseFulfillCallback(promise);
	//fprintf(stderr, "fxOnResolvedPromise %d\n", promise->next->ID);
	if (slot->kind == XS_REFERENCE_KIND) {
		mxTry(the) {
			mxPushSlot(argument);
			/* COUNT */
			mxPushInteger(1);
			/* THIS */
			mxPushUndefined();
			/* FUNCTION */
			mxPushSlot(slot);
			fxCall(the);
			mxPullSlot(argument);
		}
		mxCatch(the) {
			*argument = mxException;
			function = &mxRejectPromiseFunction;
		}
	}
	mxPushSlot(argument);
	/* COUNT */
	mxPushInteger(1);
	/* THIS */
	mxPushReference(promise);
	/* FUNCTION */
	mxPushSlot(function);
	fxCall(the);
	the->stack++;
}

void fxRejectPromise(txMachine* the)
{
	txSlot* promise = mxThis->value.reference;
	txSlot* argument = mxArgv(0);
	txSlot* result;
	txSlot* slot;
	//fprintf(stderr, "fxRejectPromise %d\n", promise->next->ID);
	result = mxPromiseResult(promise);
	result->kind = argument->kind;
	result->value = argument->value;
	slot = mxPromiseThens(promise)->value.reference->next;
	while (slot) {
		mxPushSlot(argument);
		/* COUNT */
		mxPushInteger(1);
		/* THIS */
		mxPushReference(slot->value.reference);
		/* FUNCTION */
		mxPush(mxOnRejectedPromiseFunction);
		/* TARGET */
		mxPushUndefined();
		fxQueueJob(the, XS_NO_ID);
		slot = slot->next;
	}
	slot = mxPromiseStatus(promise);
	slot->value.integer = mxRejectedStatus;
}

void fxResolvePromise(txMachine* the)
{
	txSlot* promise = mxThis->value.reference;
	txSlot* argument = mxArgv(0);
	txSlot* slot;
	txSlot* function;
	txSlot* already;
	txSlot* result;
	//fprintf(stderr, "fxResolvePromise %d\n", promise->next->ID);
	if (mxIsReference(argument)) {
		mxPushSlot(argument);
		fxGetID(the, mxID(_then));
		slot = the->stack;
		if (mxIsReference(slot)) {
			function = slot->value.reference;
			if (mxIsFunction(function)) {
				already = fxNewPromiseAlready(the);
				fxNewPromiseFunction(the, already, promise, mxResolvePromiseFunction.value.reference);
				fxNewPromiseFunction(the, already, promise, mxRejectPromiseFunction.value.reference);
				/* COUNT */
				mxPushInteger(2);
				/* THIS */
				mxPushSlot(argument);
				/* FUNCTION */
				mxPushReference(function);
				/* TARGET */
				mxPushUndefined();
				fxQueueJob(the, XS_NO_ID);
				mxPop();
				mxPop();
				return;
			}
		}
		mxPop();
	}
	result = mxPromiseResult(promise);
	result->kind = argument->kind;
	result->value = argument->value;
	slot = mxPromiseThens(promise)->value.reference->next;
	while (slot) {
		mxPushSlot(result);
		/* COUNT */
		mxPushInteger(1);
		/* THIS */
		mxPushReference(slot->value.reference);
		/* FUNCTION */
		mxPush(mxOnResolvedPromiseFunction);
		/* TARGET */
		mxPushUndefined();
		fxQueueJob(the, XS_NO_ID);
		slot = slot->next;
	}
	slot = mxPromiseStatus(promise);
	slot->value.integer = mxFulfilledStatus;
}

void fx_Promise(txMachine* the)
{
	txSlot* promise;
	txSlot* function;
	txSlot* slot;
	txSlot* already;
	if (!mxIsReference(mxThis))
		mxTypeError("this is no object");
	promise = mxThis->value.reference;
	if (!mxIsPromise(promise))
		mxTypeError("this is no promise");
	if (mxArgc < 1)
		mxSyntaxError("no executor parameter");
	if (!mxIsReference(mxArgv(0)))
		mxTypeError("executor is no object");
	function = mxArgv(0)->value.reference;
	if (!mxIsFunction(function))
		mxTypeError("executor is no function");
	slot = mxPromiseStatus(promise);
	slot->value.integer = mxPendingStatus;
	already = fxNewPromiseAlready(the);
	fxNewPromiseFunction(the, already, promise, mxResolvePromiseFunction.value.reference);
	fxNewPromiseFunction(the, already, promise, mxRejectPromiseFunction.value.reference);
	/* COUNT */
	mxPushInteger(2);
	/* THIS */
	mxPushUndefined();
	/* FUNCTION */
	mxPushReference(function);
	fxCall(the);
	the->stack += 2;
}

void fx_Promise_all(txMachine* the)
{
	txSlot* promise;
	txSlot* array;
	txInteger index;
	txSlot* count;
	txSlot* iterator;
	txSlot* result;
	txSlot* argument;
	txSlot* already;
	txSlot* rejectFunction;
	txSlot* slot;
	if (!mxIsReference(mxArgv(0)))
		mxTypeError("iterable is no object");
	mxPushSlot(mxThis);
	fxGetID(the, mxID(_Symbol_species));
	fxGetID(the, mxID(_prototype));
	promise = fxNewPromiseInstance(the);
    slot = mxPromiseStatus(promise);
    slot->value.integer = mxPendingStatus;
	already = fxNewPromiseAlready(the);
	rejectFunction = fxNewPromiseFunction(the, already, promise, mxRejectPromiseFunction.value.reference);
	mxPush(mxArrayPrototype);
	fxNewArrayInstance(the);
	mxPushUndefined();
	array = the->stack->value.closure = fxNewSlot(the);
	the->stack->kind = XS_CLOSURE_KIND;
	array->kind = XS_REFERENCE_KIND;
	array->value.reference = (the->stack + 1)->value.reference;
	index = 0;
	mxPushUndefined();
	count = the->stack->value.closure = fxNewSlot(the);
	the->stack->kind = XS_CLOSURE_KIND;
	count->kind = XS_INTEGER_KIND;
	count->value.integer = 0;
	mxPushInteger(0);
	mxPushSlot(mxArgv(0));
	fxCallID(the, mxID(_Symbol_iterator));
	iterator = the->stack;
	for(;;) {
		mxPushInteger(0);
		mxPushSlot(iterator);
		fxCallID(the, mxID(_next));
		result = the->stack;
		slot = fxGetProperty(the,result->value.reference, mxID(_done));
		if (!slot)
			mxTypeError("iterable.next() returns no done");
		if (slot->value.boolean)
			break;
		argument = fxGetProperty(the, result->value.reference, mxID(_value));
		if (!argument)
			mxTypeError("iterable.next() returns no value");
		the->stack->kind = argument->kind;
		the->stack->value = argument->value;
		mxPushInteger(1);
		mxPushSlot(mxThis);
		fxCallID(the, mxID(_resolve));
		argument = the->stack;
		already = fxNewPromiseAlready(the);
		fxNewPromiseFunctionAll(the, already, array, index, count, promise, mxResolvePromiseFunction.value.reference);
		mxPushReference(rejectFunction);
		mxPushInteger(2);
		mxPushSlot(argument);
		fxCallID(the, mxID(_then));
		the->stack += 3;
		index++;
	}
	count->value.integer += index;
	the->stack += 7;
	mxPullSlot(mxResult);
}

void fx_Promise_race(txMachine* the)
{
	txSlot* promise;
	txSlot* slot;
	txSlot* already;
	txSlot* resolveFunction;
	txSlot* rejectFunction;
	txSlot* iterator;
	txSlot* result;
	txSlot* argument;
	if (!mxIsReference(mxArgv(0)))
		mxTypeError("iterable is no object");
	mxPushSlot(mxThis);
	fxGetID(the, mxID(_Symbol_species));
	fxGetID(the, mxID(_prototype));
	promise = fxNewPromiseInstance(the);
    slot = mxPromiseStatus(promise);
    slot->value.integer = mxPendingStatus;
	already = fxNewPromiseAlready(the);
	resolveFunction = fxNewPromiseFunction(the, already, promise, mxResolvePromiseFunction.value.reference);
	rejectFunction = fxNewPromiseFunction(the, already, promise, mxRejectPromiseFunction.value.reference);
	mxPushInteger(0);
	mxPushSlot(mxArgv(0));
	fxCallID(the, mxID(_Symbol_iterator));
	iterator = the->stack;
	for(;;) {
		mxPushInteger(0);
		mxPushSlot(iterator);
		fxCallID(the, mxID(_next));
		result = the->stack;
		slot = fxGetProperty(the, result->value.reference, mxID(_done));
		if (!slot)
			mxTypeError("iterable.next() returns no done");
		if (slot->value.boolean)
			break;
		argument = fxGetProperty(the, result->value.reference, mxID(_value));
		if (!argument)
			mxTypeError("iterable.next() returns no value");
		the->stack->kind = argument->kind;
		the->stack->value = argument->value;
		mxPushInteger(1);
		mxPushSlot(mxThis);
		fxCallID(the, mxID(_resolve));
		argument = the->stack;
		mxPushReference(resolveFunction);
		mxPushReference(rejectFunction);
		mxPushInteger(2);
		mxPushSlot(argument);
		fxCallID(the, mxID(_then));
		the->stack += 2;
	}
	the->stack += 5;
	mxPullSlot(mxResult);
}

void fx_Promise_reject(txMachine* the)
{
	txSlot* promise;
	if (mxArgc == 0)
		mxSyntaxError("no arguments");
	mxPushSlot(mxThis);
	fxGetID(the, mxID(_Symbol_species));
	fxGetID(the, mxID(_prototype));
	promise = fxNewPromiseInstance(the);
	mxPushSlot(mxArgv(0));
	/* COUNT */
	mxPushInteger(1);
	/* THIS */
	mxPushReference(promise);
	/* FUNCTION */
	mxPush(mxRejectPromiseFunction);
	fxCall(the);
	the->stack++;
	mxPullSlot(mxResult);
}

void fx_Promise_resolve(txMachine* the)
{
	txSlot* promise;
	if (mxArgc == 0)
		mxSyntaxError("no arguments");
	if (mxIsReference(mxArgv(0))) {
		promise = mxArgv(0)->value.reference;
		if (mxIsPromise(promise)) {
			*mxResult = *mxArgv(0);
			return;
		}
	}
	mxPushSlot(mxThis);
	fxGetID(the, mxID(_Symbol_species));
	fxGetID(the, mxID(_prototype));
	promise = fxNewPromiseInstance(the);
	mxPushSlot(mxArgv(0));
	/* COUNT */
	mxPushInteger(1);
	/* THIS */
	mxPushReference(promise);
	/* FUNCTION */
	mxPush(mxResolvePromiseFunction);
	fxCall(the);
	the->stack++;
	mxPullSlot(mxResult);
}

void fx_Promise_prototype_catch(txMachine* the)
{
	mxPushUndefined();
	if (mxArgc > 0) 
		mxPushSlot(mxArgv(0));
	else
		mxPushUndefined();
	mxPushInteger(2);
	mxPushSlot(mxThis);
	fxCallID(the, mxID(_then));
	mxPullSlot(mxResult);
}

void fx_Promise_prototype_dumpAux(txMachine* the, txSlot* promise, txInteger c)
{
	txInteger i;
	txSlot* reference;
	for (i = 0; i < c; i++)
		fprintf(stderr, "\t");
	fprintf(stderr, "promise %d\n", promise->next->ID);
	reference = mxPromiseThens(promise)->value.reference->next;
    c++;
	while (reference) {
		fx_Promise_prototype_dumpAux(the, reference->value.reference, c);
		reference = reference->next;
	}
}

void fx_Promise_prototype_then(txMachine* the)
{
	txSlot* promise;
	txSlot* then;
	txSlot* function;
	txSlot* slot;
	txSlot** address;
	if (!mxIsReference(mxThis))
		mxTypeError("this is no object");
	promise = mxThis->value.reference;
	if (!mxIsPromise(promise))
		mxTypeError("this is no promise");
	mxPushSlot(mxThis);
	fxGetID(the, mxID(_constructor));
	fxGetID(the, mxID(_Symbol_species));
	fxGetID(the, mxID(_prototype));
	then = fxNewPromiseInstance(the);
	slot = mxPromiseStatus(then);
	slot->value.integer = mxPendingStatus;
	if ((mxArgc > 0) && mxIsReference(mxArgv(0))) {
		function = mxArgv(0)->value.reference;
		if (mxIsFunction(function)) {
			slot = mxPromiseFulfillCallback(then);
			slot->kind = XS_REFERENCE_KIND;
			slot->value.reference = function;
		}
	}
	if ((mxArgc > 1) && mxIsReference(mxArgv(1))) {
		function = mxArgv(1)->value.reference;
		if (mxIsFunction(function)) {
			slot = mxPromiseRejectCallback(then);
			slot->kind = XS_REFERENCE_KIND;
			slot->value.reference = function;
		}
	}
	slot = mxPromiseStatus(promise);
	if (slot->value.integer == mxPendingStatus) {
		address = &(mxPromiseThens(promise)->value.reference->next);
		while ((slot = *address)) 
			address = &(slot->next);
		slot = *address = fxNewSlot(the);
		slot->kind = XS_REFERENCE_KIND;
		slot->value.reference = then;
	}
	else {
		slot = mxPromiseResult(promise);
		mxPushSlot(slot);
		/* COUNT */
		mxPushInteger(1);
		/* THIS */
		mxPushReference(then);
		/* FUNCTION */
		slot = mxPromiseStatus(promise);
		if (slot->value.integer == mxFulfilledStatus)
			mxPush(mxOnResolvedPromiseFunction);
		else
			mxPush(mxOnRejectedPromiseFunction);
        /* TARGET */
		mxPushUndefined();
		fxQueueJob(the, XS_NO_ID);
	}
	mxPullSlot(mxResult);
}

void fxQueueJob(txMachine* the, txID id)
{
	txInteger count, index;
	txSlot* job;
	txSlot* stack;
	txSlot* slot;
	txSlot** address;
	
	if (mxPendingJobs.value.reference->next == NULL) {
		fxQueuePromiseJobs(the);
	}
	job = fxNewInstance(the);
	stack = the->stack + 4;
	slot = job->next = fxNewSlot(the);
	slot->ID = id;
	slot->kind = XS_INTEGER_KIND;
	count = slot->value.integer = stack->value.integer;
	stack += count;
	for (index = 0; index < count; index++) {
		slot = slot->next = fxNewSlot(the);
		slot->kind = stack->kind;
		slot->value = stack->value;
		stack--;
	}
	slot = slot->next = fxNewSlot(the);
	slot->kind = stack->kind;
	slot->value = stack->value;
	stack--;
	slot = slot->next = fxNewSlot(the);
	slot->kind = stack->kind;
	slot->value = stack->value;
	stack--;
	slot = slot->next = fxNewSlot(the);
	slot->kind = stack->kind;
	slot->value = stack->value;
	stack--;
	slot = slot->next = fxNewSlot(the);
	slot->kind = stack->kind;
	slot->value = stack->value;
	
	address = &(mxPendingJobs.value.reference->next);
	while ((slot = *address)) 
		address = &(slot->next);
	slot = *address = fxNewSlot(the);	
	slot->kind = XS_REFERENCE_KIND;
	slot->value.reference = job;
	the->stack += 5 + count;
}

void fxRunPromiseJobs(txMachine* the)
{
	txInteger count, index;
	txSlot* job;
	txSlot* slot;
	txID id;
	
	job = mxRunningJobs.value.reference->next = mxPendingJobs.value.reference->next;
	mxPendingJobs.value.reference->next = C_NULL;
	while (job) {
		mxTry(the) {
			slot = job->value.reference->next;
			id = slot->ID;
			count = slot->value.integer;
			for (index = 0; index < count; index++) {
				slot = slot->next;
				mxPushSlot(slot);
			}
			/* COUNT */
			slot = slot->next;
			mxPushSlot(slot);
			/* THIS */
			slot = slot->next;
			mxPushSlot(slot);
			/* FUNCTION */
			slot = slot->next;
			mxPushSlot(slot);
			/* TARGET */
			slot = slot->next;
			mxPushSlot(slot);
			/* RESULT */
			mxPushUndefined();
			fxRunID(the, C_NULL, id);
			the->stack++;
		}
		mxCatch(the) {
		}
		job = job->next;
	}
	mxRunningJobs.value.reference->next = C_NULL;
}





