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
#ifndef __KPR_IOS__
#define __KPR_IOS__

#if TARGET_OS_IPHONE

#include "kpr.h"
#include "kprMedia.h"
#include "kprUPnP.h"

#ifdef __cplusplus
extern "C" {
#endif /* __cplusplus */

void KprSystemNowPlayingInfoSetIdling(Boolean idling);
Boolean KprSystemNowPlayingInfoGetIdling(void);
void KprSystemNowPlayingInfoSetMetadata(KprMedia media, FskMediaPropertyValue artwork);
void KprSystemNowPlayingInfoSetUPnPMetadata(KprUPnPMetadata metadata);
void KprSystemNowPlayingInfoSetNativeMetadata(void *metadataIn, Boolean append);
void KprSystemNowPlayingInfoSetTime(double duration, double position);

void KprToneGeneratorPlay();
void KprToneGeneratorStop();

#ifdef __cplusplus
}
#endif /* __cplusplus */

#endif

#endif
