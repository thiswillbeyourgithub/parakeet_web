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

export enum LedStatePM3 {
  OFF = 0,
  RED = 1,
  GREEN = 2,
}

const BUTTON_MAPPINGS = new Map<ButtonEvent, number>([
  [ButtonEvent.TRANSCRIBE, 1 << 0],
  [ButtonEvent.TAB_BACKWARD, 1 << 1],
  [ButtonEvent.RECORD, 1 << 2],
  [ButtonEvent.TAB_FORWARD, 1 << 3],
  [ButtonEvent.REWIND, 1 << 4],
  [ButtonEvent.FORWARD, 1 << 5],
  [ButtonEvent.PLAY, 1 << 6],
  [ButtonEvent.CUSTOM_LEFT, 1 << 7],
  [ButtonEvent.ENTER_SELECT, 1 << 8],
  [ButtonEvent.CUSTOM_RIGHT, 1 << 9],
]);

export class PowerMic3Device extends DictationDeviceBase {
  readonly implType = ImplementationType.POWERMIC_3;

  static create(hidDevice: HIDDevice) {
    return new PowerMic3Device(hidDevice);
  }

  getDeviceType(): DeviceType {
    return DeviceType.POWERMIC_3;
  }

  async setLed(state: LedStatePM3) {
    const data = new Uint8Array([state]);
    await this.hidDevice.sendReport(/* reportId= */ 0, data);
  }

  protected getButtonMappings(): Map<ButtonEvent, number> {
    return BUTTON_MAPPINGS;
  }

  protected getInputBitmask(data: DataView): number {
    return data.getUint16(1, /* littleEndian= */ true);
  }

  protected getThisAsDictationDevice(): PowerMic3Device {
    return this;
  }
}
