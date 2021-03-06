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
import * as FS from "fs";

export default class Android {
	constructor(tree) {
		this.tree = tree;
	}
	completeInfo(tool) {
		var environment = this.tree.environment;
		var info = this.tree.info;
		if (!("features" in info))
			info.features = {};
		if (!("location.gps" in info.features))
			info.features["location.gps"] = false;
		if (!("telephony" in info.features))
			info.features["telephony"] = false;
		if (!("permissions" in info))
			info.permissions = [];
		info.permissions.push("ACCESS_NETWORK_STATE");
		info.permissions.push("BLUETOOTH");
		info.permissions.push("BLUETOOTH_ADMIN");
		info.permissions.push("INTERNET");
		info.permissions.push("MODIFY_AUDIO_SETTINGS");
		info.permissions.push("READ_EXTERNAL_STORAGE");
		info.permissions.push("WAKE_LOCK");
		info.permissions.push("WRITE_EXTERNAL_STORAGE");

		if (!("version" in info))
			info.version = {};
		if (!("minimum" in info.version))
			info.version.minimum = 9;
		if (!("target" in info.version))
			info.version.target = 17;
		switch (info.orientation) {
			case "portrait":
				info.orientation = { type: "portrait", option: "" }
			break;
			case "landscape":
				info.orientation = { type: "landscape", option: "" }
			break;
			case "sensorPortrait":
				info.orientation = { type: "sensorPortrait", option: "|orientation" }
			break;
			case "sensorLandscape":
				info.orientation = { type: "sensorLandscape", option: "|orientation" }
			break;
			default:
				info.orientation = { type: "sensor", option: "|orientation" }
			break;
		}
		if (!("modules" in info))
			info.modules = "";
		info.debuggable = tool.debug;
		var namespace = environment.NAMESPACE.split(".");
		info.name = namespace[namespace.length - 1];
		info.base = namespace.join("_");
		info.path = namespace.join("/");
		this.info = info;
	}
	copyDrawableFile(tool, tmp, path) {
		var appPath = tool.manifestPath.split("/");
		appPath[appPath.length - 1] = "android";
		appPath = appPath.join("/");
		var source = appPath + path;
		if (!FS.existsSync(source))
			source = tool.homePath + "/build/android/project/app/src/main/res" + path;
		var destination = tmp + "/ndk/project/app/src/main/res" + path;
		FS.copyFileSync(source, destination);
	}
	copyFile(tool, source, destination, mapping) {
		if (mapping) {
			var buffer = FS.readFileSync(source).toString();
			mapping.forEach(function(map) {
				var regex = new RegExp(map.key, "g");
				buffer = buffer.replace(regex, map.value);
			});
			FS.writeFileSync(destination, buffer);
		}
		else
			FS.copyFileSync(source, destination);
	}
	copyJavaFile(tool, tmp, path, name, mapping) {
		var allPermissions = [
			"ACCESS_FINE_LOCATION",
			"ACCESS_NETWORK_STATE",
			"ACCESS_WIFI_STATE",
			"C2D_MESSAGE",
			"CALL_PHONE",
			"READ_CONTACTS",
			"READ_PHONE_STATE",
			"READ_SMS",
			"RECEIVE_SMS",
			"SEND_SMS"
		];
		var source = tool.homePath + "/build/android/project/app/src/main/java/com/kinoma/kinomaplay/" + name;
		var destination = tmp + "/ndk" + path + "/" + name;
		var buffer = FS.readFileSync(source).toString();
		mapping.forEach(function(map) {
			var regex = new RegExp(map.key, "g");
			buffer = buffer.replace(regex, map.value);
		});
		var stop = "//#endif";
		for (let permission of allPermissions) {
			var exclude = this.info.permissions.indexOf(permission) == -1;
			var start = "//#ifdefined " + permission;
			var length = start.length;
			var startIndex, stopIndex;
			while ((startIndex = buffer.lastIndexOf(start)) >= 0) {
				if (exclude) {
					stopIndex = buffer.indexOf(stop, startIndex);
					buffer = buffer.substr(0, startIndex - 1) + buffer.substr(stopIndex + 8);
				}
				else {
					buffer = buffer.substr(0, startIndex - 1) + buffer.substr(startIndex + length);
					stopIndex = buffer.indexOf(stop, startIndex);
					buffer = buffer.substr(0, stopIndex - 1) + buffer.substr(stopIndex + 8);
				}
			}
		}
		FS.writeFileSync(destination, buffer);
	}
	copyKinomaFile(tool, tmp, path, mapping) {
		var source = tool.homePath + "/build/android/inNDK/kinoma" + path;
		var destination = tmp + "/ndk/project/jni" + path;
		this.copyFile(tool, source, destination, mapping);
	}
	copyNdkFile(tool, tmp, path, mapping) {
		var source = tool.homePath + "/build/android/project" + path;
		var destination = tmp + "/ndk/project" + path;
		this.copyFile(tool, source, destination, mapping);
	}
	generateNdk(tool, tmp, bin) {
		var environment = this.tree.environment;
		var info = this.tree.info;

		// create directory structure
		FS.mkdirSync(tmp + "/ndk");
		
		FS.mkdirSync(tmp + "/ndk/project");
		FS.mkdirSync(tmp + "/ndk/project/app");
		FS.mkdirSync(tmp + "/ndk/project/app/src");
		FS.mkdirSync(tmp + "/ndk/project/app/src/main");
		var features = "";
		for (let feature in info.features)
			features += '\t<uses-feature android:name="' + feature + '" android:required="' + info.features[feature] + '"/>\n';
		var permissions = "";
		for (let i = 0, c = info.permissions.length; i < c; i++)
			permissions += '\t<uses-permission android:name="android.permission.' + info.permissions[i] + '"/>\n';
		var versionCode = 1;
		if (environment.ANDROID_VERSION_CODE)
			versionCode = environment.ANDROID_VERSION_CODE;
		this.copyNdkFile(tool, tmp, "/app/src/main/AndroidManifest.xml", [
			{ "key": "#NAMESPACE#", "value": environment.NAMESPACE },
			{ "key": "#VERSION#", "value": environment.VERSION },
			{ "key": "#VERSION_MINIMUM#", "value": info.version.minimum },
			{ "key": "#VERSION_TARGET#", "value": info.version.target },
			{ "key": "#ANDROID_DEBUGGABLE#", "value": info.debuggable },
			{ "key": "#ORIENTATION_TYPE#", "value": info.orientation.type },
			{ "key": "#ORIENTATION_OPTION#", "value": info.orientation.option },
			{ "key": "#MANIFEST_MODULES#", "value": "" },
			{ "key": "#MANIFEST_PERMISSIONS#", "value": permissions },
			{ "key": "#MANIFEST_FEATURES#", "value": features },
			{ "key": "#ANDROID_VERSION_CODE#", "value": versionCode },
		]);

		this.copyNdkFile(tool, tmp, "/build.gradle", null);
		this.copyNdkFile(tool, tmp, "/gradle.properties", null);
		this.copyNdkFile(tool, tmp, "/gradlew", null);
		this.copyNdkFile(tool, tmp, "/gradlew.bat", null);
		this.copyNdkFile(tool, tmp, "/local.properties", [
			{ "key": "#ANDROID_SDK#", "value": process.getenv("ANDROID_SDK") },
			{ "key": "#ANDROID_NDK#", "value": process.getenv("ANDROID_NDK") }
		]);
		this.copyNdkFile(tool, tmp, "/settings.gradle", null);

		FS.mkdirSync(tmp + "/ndk/project/gradle");
		FS.mkdirSync(tmp + "/ndk/project/gradle/wrapper");
		this.copyNdkFile(tool, tmp, "/gradle/wrapper/gradle-wrapper.jar");
		this.copyNdkFile(tool, tmp, "/gradle/wrapper/gradle-wrapper.properties");

		var sdkPath = process.getenv("ANDROID_SDK");
		var buildToolsPath = sdkPath + "/build-tools";
		var buildTools = FS.readDirSync(buildToolsPath);
		var buildToolsVersion = buildTools[buildTools.length - 1];

		var version = buildTools.pop();
		var file = FS.readFileSync(buildToolsPath + "/" + version + "/source.properties");
		var matches = file.match(/Pkg.Revision=(.*)/);
		var buildToolsVersion = matches[1] ? matches[1] : version;

		var keystore = process.getenv("HOME") + "/.android/debug.keystore";
		var keystore_pass = "android";
		var keystore_alias = "androiddebugkey";

		var localPropertiesPath = process.getenv("HOME") + "/.android.keystore.info";
		if (FS.existsSync(localPropertiesPath)) {
		 	var buffer = FS.readFileSync(localPropertiesPath);
			var json = JSON.parse(buffer);
			if (json) {
				keystore = json.keystore;
				keystore_pass = json.password;
				keystore_alias = json.alias;
			}
		 }

		this.copyNdkFile(tool, tmp, "/app/build.gradle", [
			{ "key": "#ANDROID_VERSION_CODE#", "value": versionCode },
			{ "key": "#BUILD_TOOLS_VERSION#", "value": buildToolsVersion },
			{ "key": "#NAMESPACE#", "value": environment.NAMESPACE },
			{ "key": "#VERSION#", "value": environment.VERSION },
			{ "key": "#KEYSTORE#", "value": keystore },
			{ "key": "#KEYSTORE_PASS#", "value": keystore_pass },
			{ "key": "#KEYSTORE_ALIAS#", "value": keystore_alias }
		]);
		this.copyNdkFile(tool, tmp, "/app/proguard-rules.pro");

		FS.mkdirSync(tmp + "/ndk/project/app/src/main/res");

		FS.mkdirSync(tmp + "/ndk/project/app/src/main/res/drawable");
		this.copyDrawableFile(tool, tmp, "/drawable/icon.png");
		this.copyDrawableFile(tool, tmp, "/drawable/splashscreen.png");
		this.copyDrawableFile(tool, tmp, "/drawable/web_return_icon.png");
		FS.mkdirSync(tmp + "/ndk/project/app/src/main/res/drawable-hdpi");
		this.copyDrawableFile(tool, tmp, "/drawable-hdpi/ball.png");
		this.copyDrawableFile(tool, tmp, "/drawable-hdpi/icon.png");
		FS.mkdirSync(tmp + "/ndk/project/app/src/main/res/drawable-ldpi");
		this.copyDrawableFile(tool, tmp, "/drawable-hdpi/ball.png");
		this.copyDrawableFile(tool, tmp, "/drawable-ldpi/icon.png");
		FS.mkdirSync(tmp + "/ndk/project/app/src/main/res/drawable-mdpi");
		this.copyDrawableFile(tool, tmp, "/drawable-hdpi/ball.png");
		this.copyDrawableFile(tool, tmp, "/drawable-mdpi/icon.png");
		FS.mkdirSync(tmp + "/ndk/project/app/src/main/res/drawable-xhdpi");
		this.copyDrawableFile(tool, tmp, "/drawable-xhdpi/ball.png");

		FS.mkdirSync(tmp + "/ndk/project/app/src/main/res/layout");
		this.copyNdkFile(tool, tmp, "/app/src/main/res/layout/main.xml", [ { "key": "com.kinoma.kinomaplay", "value": environment.NAMESPACE } ]);
		this.copyNdkFile(tool, tmp, "/app/src/main/res/layout/splashscreen.xml", null);
		this.copyNdkFile(tool, tmp, "/app/src/main/res/layout/web_r.xml", null);
		this.copyNdkFile(tool, tmp, "/app/src/main/res/layout/web.xml", null);

		FS.mkdirSync(tmp + "/ndk/project/app/src/main/res/values");
		this.copyNdkFile(tool, tmp, "/app/src/main/res/values/strings.xml", [{ "key": "#APP_NAME#", "value": environment.NAME }]);
		this.copyNdkFile(tool, tmp, "/app/src/main/res/values/theme.xml", null);
		
//		FS.mkdirSync(tmp + "/ndk/project/src/main/res/xml");
//		this.copyNdkFile(tool, tmp, "/project/src/main/res/xml/kconfig.xml", null);

		// // transform java sources
		FS.mkdirSync(tmp + "/ndk/project/app/src/main/java");
		var namespace = environment.NAMESPACE.split(".");
		for (let i = 0, c = namespace.length, path = tmp + "/ndk/project/app/src/main/java"; i < c; i++) {
			path += "/" + namespace[i];
			FS.mkdirSync(path);
		}
		var javaPath = "/project/app/src/main/java/" + namespace.join("/");
		var javaMapping = [
			{ "key": "com.kinoma.kinomaplay", "value": environment.NAMESPACE },
			{ "key": "Kinoma Play", "value": "Kinoma " + environment.NAME },
			{ "key": "\r\n", "value": "\n" } // prevent mixed line endings
		];
		this.copyJavaFile(tool, tmp, javaPath, "FskEditText.java", javaMapping);
		this.copyJavaFile(tool, tmp, javaPath, "FskProperties.java", javaMapping);
		this.copyJavaFile(tool, tmp, javaPath, "FskView.java", javaMapping);
		this.copyJavaFile(tool, tmp, javaPath, "FskViewGL.java", javaMapping);
		this.copyJavaFile(tool, tmp, javaPath, "FskCamera.java", javaMapping);
		this.copyJavaFile(tool, tmp, javaPath, "IFskView.java", javaMapping);
		this.copyJavaFile(tool, tmp, javaPath, "KinomaPlay.java", javaMapping);
		this.copyJavaFile(tool, tmp, javaPath, "KinomaService.java", javaMapping);
		this.copyJavaFile(tool, tmp, javaPath, "MediaCodecCore.java", javaMapping);
		this.copyJavaFile(tool, tmp, javaPath, "Play2Android.java", javaMapping);
		this.copyJavaFile(tool, tmp, javaPath, "RemoteControlReceiver.java", javaMapping);

		var kinomaMapping = [
			{ "key": "com_kinoma_kinomaplay", "value": info.base },
			{ "key": "com/kinoma/kinomaplay", "value": info.path },
			{ "key": "#F_HOME#", "value": tool.homePath },
			{ "key": "#TMPDIR#", "value": tool.tmpPath }
		];
		
		FS.mkdirSync(tmp + "/ndk/project/modules");
		FS.mkdirSync(tmp + "/ndk/project/modules/Fsk");
		FS.mkdirSync(tmp + "/ndk/project/modules/Fsk/src");
		FS.mkdirSync(tmp + "/ndk/project/modules/Fsk/src/main");
		FS.mkdirSync(tmp + "/ndk/project/modules/Fsk/src/main/jni");

		this.copyNdkFile(tool, tmp, "/modules/Fsk/build.gradle", kinomaMapping);
		this.copyNdkFile(tool, tmp, "/modules/Fsk/src/main/jni/mainHelper.c", kinomaMapping);

		FS.mkdirSync(tmp + "/ndk/project/modules/KinomaLib");
		FS.mkdirSync(tmp + "/ndk/project/modules/KinomaLib/src");
		FS.mkdirSync(tmp + "/ndk/project/modules/KinomaLib/src/main");
		FS.mkdirSync(tmp + "/ndk/project/modules/KinomaLib/src/main/jni");

		this.copyNdkFile(tool, tmp, "/modules/KinomaLib/build.gradle", kinomaMapping);
		this.copyNdkFile(tool, tmp, "/modules/KinomaLib/src/main/jni/KinomaFiles.c", kinomaMapping);
		this.copyNdkFile(tool, tmp, "/modules/KinomaLib/src/main/jni/KinomaInterface.cpp", kinomaMapping);
		this.copyNdkFile(tool, tmp, "/modules/KinomaLib/src/main/jni/KinomaInterfaceLib.h", kinomaMapping);
		this.copyNdkFile(tool, tmp, "/modules/KinomaLib/src/main/jni/KinomaLib.c", kinomaMapping);
		this.copyNdkFile(tool, tmp, "/modules/KinomaLib/src/main/jni/gingerbreadStuff.cpp", kinomaMapping);
	}
};
