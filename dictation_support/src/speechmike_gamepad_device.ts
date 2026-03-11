/**
 * @license
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {ButtonEvent, DeviceType, DictationDeviceBase, ImplementationType,} from './dictation_device_base';

const BUTTON_MAPPINGS_SPEECHMIKE = new Map<ButtonEvent, number>([
  [ButtonEvent.REWIND, 1 << 0],
  [ButtonEvent.PLAY, 1 << 1],
  [ButtonEvent.FORWARD, 1 << 2],
  [ButtonEvent.INS_OVR, 1 << 4],
  [ButtonEvent.RECORD, 1 << 5],
  [ButtonEvent.COMMAND, 1 << 6],
  [ButtonEvent.INSTR, 1 << 9],
  [ButtonEvent.F1_A, 1 << 10],
  [ButtonEvent.F2_B, 1 << 11],
  [ButtonEvent.F3_C, 1 << 12],
  [ButtonEvent.F4_D, 1 << 13],
  [ButtonEvent.EOL_PRIO, 1 << 14],
]);

const BUTTON_MAPPINGS_POWERMIC_4 = new Map<ButtonEvent, number>([
  [ButtonEvent.TAB_BACKWARD, 1 << 0],
  [ButtonEvent.PLAY, 1 << 1],
  [ButtonEvent.TAB_FORWARD, 1 << 2],
  [ButtonEvent.FORWARD, 1 << 4],
  [ButtonEvent.RECORD, 1 << 5],
  [ButtonEvent.COMMAND, 1 << 6],
  [ButtonEvent.ENTER_SELECT, 1 << 9],
  [ButtonEvent.F1_A, 1 << 10],
  [ButtonEvent.F2_B, 1 << 11],
  [ButtonEvent.F3_C, 1 << 12],
  [ButtonEvent.F4_D, 1 << 13],
  [ButtonEvent.REWIND, 1 << 14],
]);

export class SpeechMikeGamepadDevice extends DictationDeviceBase {
  readonly implType = ImplementationType.SPEECHMIKE_GAMEPAD;

  static create(hidDevice: HIDDevice) {
    return new SpeechMikeGamepadDevice(hidDevice);
  }

  getDeviceType(): DeviceType {
    // All SpeechMikes have the same productId (except PowerMic IV) and the lfh
    // is only available on the SpeechMikeHidDevice. Since this device is only
    // used as proxy within a SpeechMikeHidDevice, we don't really care about
    // the type here.
    return DeviceType.UNKNOWN;
  }

  protected getButtonMappings(): Map<ButtonEvent, number> {
    if (this.hidDevice.vendorId === 0x0554 &&
        this.hidDevice.productId === 0x0064) {
      return BUTTON_MAPPINGS_POWERMIC_4;
    }
    return BUTTON_MAPPINGS_SPEECHMIKE;
  }

  protected getInputBitmask(data: DataView): number {
    return data.getUint16(0, /* littleEndian= */ true);
  }

  protected getThisAsDictationDevice(): SpeechMikeGamepadDevice {
    return this;
  }
}
