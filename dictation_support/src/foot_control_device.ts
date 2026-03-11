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

const BUTTON_MAPPINGS = new Map<ButtonEvent, number>([
  [ButtonEvent.REWIND, 1 << 0],
  [ButtonEvent.PLAY, 1 << 1],
  [ButtonEvent.FORWARD, 1 << 2],
  [ButtonEvent.EOL_PRIO, 1 << 3],
]);

export class FootControlDevice extends DictationDeviceBase {
  readonly implType = ImplementationType.FOOT_CONTROL;

  static create(hidDevice: HIDDevice) {
    return new FootControlDevice(hidDevice);
  }

  getDeviceType(): DeviceType {
    if (this.hidDevice.vendorId === 0x0911) {
      if (this.hidDevice.productId === 0x1844) {
        return DeviceType.FOOT_CONTROL_ACC_2310_2320;
      } else if (this.hidDevice.productId === 0x091a) {
        return DeviceType.FOOT_CONTROL_ACC_2330;
      }
      return DeviceType.UNKNOWN;
    }
    return DeviceType.UNKNOWN;
  }

  protected getButtonMappings(): Map<ButtonEvent, number> {
    return BUTTON_MAPPINGS;
  }

  protected getInputBitmask(data: DataView): number {
    return data.getUint8(0);
  }

  protected getThisAsDictationDevice(): FootControlDevice {
    return this;
  }
}
