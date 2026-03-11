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

import {DictationDevice} from './dictation_device';

export enum ImplementationType {
  SPEECHMIKE_HID = 0,
  SPEECHMIKE_GAMEPAD = 1,
  FOOT_CONTROL = 2,
  POWERMIC_3 = 3,
}

export enum DeviceType {
  UNKNOWN = 0,
  FOOT_CONTROL_ACC_2310_2320 = 6212,
  FOOT_CONTROL_ACC_2330 = 2330,
  SPEECHMIKE_LFH_3200 = 3200,
  SPEECHMIKE_LFH_3210 = 3210,
  SPEECHMIKE_LFH_3220 = 3220,
  SPEECHMIKE_LFH_3300 = 3300,
  SPEECHMIKE_LFH_3310 = 3310,
  SPEECHMIKE_LFH_3500 = 3500,
  SPEECHMIKE_LFH_3510 = 3510,
  SPEECHMIKE_LFH_3520 = 3520,
  SPEECHMIKE_LFH_3600 = 3600,
  SPEECHMIKE_LFH_3610 = 3610,
  SPEECHMIKE_SMP_3700 = 3700,
  SPEECHMIKE_SMP_3710 = 3710,
  SPEECHMIKE_SMP_3720 = 3720,
  SPEECHMIKE_SMP_3800 = 3800,
  SPEECHMIKE_SMP_3810 = 3810,
  SPEECHMIKE_SMP_4000 = 4000,
  SPEECHMIKE_SMP_4010 = 4010,
  SPEECHONE_PSM_6000 = 6001,
  POWERMIC_3 = 4097,
  POWERMIC_4 = 100,
  SPEECHMIKE_AMBIENT_PSM5000 = 5000,
}

export enum ButtonEvent {
  NONE = 0,
  REWIND = 1 << 0,
  PLAY = 1 << 1,
  FORWARD = 1 << 2,
  INS_OVR = 1 << 4,
  RECORD = 1 << 5,
  COMMAND = 1 << 6,
  STOP = 1 << 8,
  INSTR = 1 << 9,
  F1_A = 1 << 10,
  F2_B = 1 << 11,
  F3_C = 1 << 12,
  F4_D = 1 << 13,
  EOL_PRIO = 1 << 14,
  TRANSCRIBE = 1 << 15,
  TAB_BACKWARD = 1 << 16,
  TAB_FORWARD = 1 << 17,
  CUSTOM_LEFT = 1 << 18,
  CUSTOM_RIGHT = 1 << 19,
  ENTER_SELECT = 1 << 20,
  SCAN_END = 1 << 21,
  SCAN_SUCCESS = 1 << 22,
}

export type ButtonEventListener =
    (device: DictationDevice, bitMask: ButtonEvent) => void|Promise<void>;

export abstract class DictationDeviceBase {
  private static next_id = 0;

  readonly id = DictationDeviceBase.next_id++;
  abstract readonly implType: ImplementationType;

  protected readonly buttonEventListeners = new Set<ButtonEventListener>();
  protected lastBitMask = 0;

  protected readonly onInputReportHandler = (event: HIDInputReportEvent) =>
      this.onInputReport(event);

  protected constructor(readonly hidDevice: HIDDevice) {}

  async init() {
    this.hidDevice.addEventListener('inputreport', this.onInputReportHandler);

    if (this.hidDevice.opened === false) {
      await this.hidDevice.open();
    }
  }

  async shutdown(closeDevice = true) {
    this.hidDevice.removeEventListener(
        'inputreport', this.onInputReportHandler);

    if (closeDevice) {
      await this.hidDevice.close();
    }

    this.buttonEventListeners.clear();
  }

  addButtonEventListener(listener: ButtonEventListener) {
    this.buttonEventListeners.add(listener);
  }

  protected async onInputReport(event: HIDInputReportEvent) {
    const data = event.data;
    await this.handleButtonPress(data);
  }

  protected async handleButtonPress(data: DataView) {
    const buttonMappings = this.getButtonMappings();
    const inputBitMask = this.getInputBitmask(data);
    let outputBitMask = 0;
    for (const [buttonEvent, buttonMapping] of buttonMappings) {
      if (inputBitMask & buttonMapping) outputBitMask |= buttonEvent;
    }

    if (outputBitMask === this.lastBitMask) return;
    this.lastBitMask = outputBitMask;

    outputBitMask = this.filterOutputBitMask(outputBitMask);

    await Promise.all([...this.buttonEventListeners].map(
        listener => listener(this.getThisAsDictationDevice(), outputBitMask)));
  }

  protected filterOutputBitMask(outputBitMask: number): number {
    return outputBitMask;  // default = no filtering
  }

  abstract getDeviceType(): DeviceType;
  protected abstract getButtonMappings(): Map<ButtonEvent, number>;
  protected abstract getInputBitmask(data: DataView): number;
  protected abstract getThisAsDictationDevice(): DictationDevice;
}
