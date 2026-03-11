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
import {ButtonEvent, DeviceType, DictationDeviceBase, ImplementationType,} from './dictation_device_base';
import {SpeechMikeGamepadDevice} from './speechmike_gamepad_device';

export enum EventMode {
  HID = 0,
  KEYBOARD = 1,
  BROWSER = 2,
  WINDOWS_SR = 3,
  DRAGON_FOR_MAC = 4,
  DRAGON_FOR_WINDOWS = 5,
}

export enum SimpleLedState {
  OFF = 0,
  RECORD_INSERT = 1,
  RECORD_OVERWRITE = 2,
  RECORD_STANDBY_INSERT = 3,
  RECORD_STANDBY_OVERWRITE = 4,
}

export enum LedIndex {
  RECORD_LED_GREEN = 0,
  RECORD_LED_RED = 1,
  INSTRUCTION_LED_GREEN = 2,
  INSTRUCTION_LED_RED = 3,
  INS_OWR_BUTTON_LED_GREEN = 4,
  INS_OWR_BUTTON_LED_RED = 5,
  F1_BUTTON_LED = 6,
  F2_BUTTON_LED = 7,
  F3_BUTTON_LED = 8,
  F4_BUTTON_LED = 9,
}

export enum LedMode {
  OFF = 0,
  BLINK_SLOW = 1,
  BLINK_FAST = 2,
  ON = 3,
}

export type LedState = Record<LedIndex, LedMode>;

export enum MotionEvent {
  PICKED_UP = 0,
  LAYED_DOWN = 1,
}

export type MotionEventListener =
    (device: DictationDevice, event: MotionEvent) => void|Promise<void>;

enum Command {
  SET_LED = 0x02,
  SET_EVENT_MODE = 0x0d,
  BUTTON_PRESS_EVENT = 0x80,
  IS_SPEECHMIKE_PREMIUM = 0x83,
  GET_DEVICE_CODE_SM3 = 0x87,
  GET_DEVICE_CODE_SMP = 0x8b,
  GET_DEVICE_CODE_SO = 0x96,
  GET_EVENT_MODE = 0x8d,
  WIRELESS_STATUS_EVENT = 0x94,
  MOTION_EVENT = 0x9e,
  GET_FIRMWARE_VERSION = 0x91,
}

const COMMAND_TIMEOUT_MS = 5000;

const BUTTON_MAPPINGS_SPEECHMIKE = new Map<ButtonEvent, number>([
  [ButtonEvent.REWIND, 1 << 12],
  [ButtonEvent.PLAY, 1 << 10],
  [ButtonEvent.FORWARD, 1 << 11],
  [ButtonEvent.INS_OVR, 1 << 14],
  [ButtonEvent.RECORD, 1 << 8],
  [ButtonEvent.COMMAND, 1 << 5],
  [ButtonEvent.STOP, 1 << 9],
  [ButtonEvent.INSTR, 1 << 15],
  [ButtonEvent.F1_A, 1 << 1],
  [ButtonEvent.F2_B, 1 << 2],
  [ButtonEvent.F3_C, 1 << 3],
  [ButtonEvent.F4_D, 1 << 4],
  [ButtonEvent.EOL_PRIO, 1 << 13],
  [ButtonEvent.SCAN_END, 1 << 0],
  [ButtonEvent.SCAN_SUCCESS, 1 << 7],
]);

const BUTTON_MAPPINGS_POWERMIC_4 = new Map<ButtonEvent, number>([
  [ButtonEvent.TAB_BACKWARD, 1 << 12],
  [ButtonEvent.PLAY, 1 << 10],
  [ButtonEvent.TAB_FORWARD, 1 << 11],
  [ButtonEvent.FORWARD, 1 << 14],
  [ButtonEvent.RECORD, 1 << 8],
  [ButtonEvent.COMMAND, 1 << 5],
  [ButtonEvent.ENTER_SELECT, 1 << 15],
  [ButtonEvent.F1_A, 1 << 1],
  [ButtonEvent.F2_B, 1 << 2],
  [ButtonEvent.F3_C, 1 << 3],
  [ButtonEvent.F4_D, 1 << 4],
  [ButtonEvent.REWIND, 1 << 13],
]);

const LED_STATE_OFF: Readonly<LedState> = Object.freeze({
  [LedIndex.RECORD_LED_GREEN]: LedMode.OFF,
  [LedIndex.RECORD_LED_RED]: LedMode.OFF,
  [LedIndex.INSTRUCTION_LED_GREEN]: LedMode.OFF,
  [LedIndex.INSTRUCTION_LED_RED]: LedMode.OFF,
  [LedIndex.INS_OWR_BUTTON_LED_GREEN]: LedMode.OFF,
  [LedIndex.INS_OWR_BUTTON_LED_RED]: LedMode.OFF,
  [LedIndex.F1_BUTTON_LED]: LedMode.OFF,
  [LedIndex.F2_BUTTON_LED]: LedMode.OFF,
  [LedIndex.F3_BUTTON_LED]: LedMode.OFF,
  [LedIndex.F4_BUTTON_LED]: LedMode.OFF,
});

const LED_STATE_RECORD_INSERT: Readonly<LedState> = Object.freeze({
  ...LED_STATE_OFF,
  [LedIndex.RECORD_LED_GREEN]: LedMode.ON,
  [LedIndex.INS_OWR_BUTTON_LED_GREEN]: LedMode.ON,
});

const LED_STATE_RECORD_OVERWRITE: Readonly<LedState> = Object.freeze({
  ...LED_STATE_OFF,
  [LedIndex.RECORD_LED_RED]: LedMode.ON,
});

const LED_STATE_RECORD_STANDBY_INSERT: Readonly<LedState> = Object.freeze({
  ...LED_STATE_OFF,
  [LedIndex.RECORD_LED_GREEN]: LedMode.BLINK_SLOW,
  [LedIndex.INS_OWR_BUTTON_LED_GREEN]: LedMode.BLINK_SLOW,
});

const LED_STATE_RECORD_STANDBY_OVERWRITE: Readonly<LedState> = Object.freeze({
  ...LED_STATE_OFF,
  [LedIndex.RECORD_LED_RED]: LedMode.BLINK_SLOW,
});

const SIMPLE_LED_STATES: Readonly<Record<SimpleLedState, Readonly<LedState>>> =
    Object.freeze({
      [SimpleLedState.OFF]: LED_STATE_OFF,
      [SimpleLedState.RECORD_INSERT]: LED_STATE_RECORD_INSERT,
      [SimpleLedState.RECORD_OVERWRITE]: LED_STATE_RECORD_OVERWRITE,
      [SimpleLedState.RECORD_STANDBY_INSERT]: LED_STATE_RECORD_STANDBY_INSERT,
      [SimpleLedState.RECORD_STANDBY_OVERWRITE]:
          LED_STATE_RECORD_STANDBY_OVERWRITE,
    });

const PHI_SLIDERS = Object.freeze([
  DeviceType.SPEECHMIKE_LFH_3220, DeviceType.SPEECHMIKE_LFH_3520,
  DeviceType.SPEECHMIKE_SMP_3720
]);
const INT_SLIDERS = Object.freeze([
  DeviceType.SPEECHMIKE_LFH_3210, DeviceType.SPEECHMIKE_LFH_3310,
  DeviceType.SPEECHMIKE_LFH_3510, DeviceType.SPEECHMIKE_LFH_3610,
  DeviceType.SPEECHMIKE_SMP_3710, DeviceType.SPEECHMIKE_SMP_3810,
  DeviceType.SPEECHMIKE_SMP_4010
]);

export class SpeechMikeHidDevice extends DictationDeviceBase {
  readonly implType = ImplementationType.SPEECHMIKE_HID;

  protected deviceCode = 0;
  protected ledState: LedState = {...LED_STATE_OFF};
  protected sliderBitsFilter = 0;
  protected lastSliderValue = 0;
  protected lastButtonValue = 0;

  protected commandResolvers = new Map<Command, (data: DataView) => void>();
  protected commandTimeouts = new Map<Command, number>();

  protected readonly motionEventListeners = new Set<MotionEventListener>();

  protected proxyDevice: SpeechMikeGamepadDevice|undefined = undefined;

  static create(hidDevice: HIDDevice) {
    return new SpeechMikeHidDevice(hidDevice);
  }

  override async init() {
    await super.init();
    await this.fetchDeviceCode();
    this.determineSliderBitsFilter();
  }

  override async shutdown() {
    await super.shutdown();

    if (this.proxyDevice !== undefined) {
      await this.proxyDevice.shutdown();
    }
  }

  addMotionEventListener(listener: MotionEventListener) {
    this.motionEventListeners.add(listener);
  }

  getDeviceCode(): number {
    return this.deviceCode;
  }

  getDeviceType(): DeviceType {
    if (this.hidDevice.vendorId === 0x0554) {
      if (this.hidDevice.productId === 0x0064) {
        return DeviceType.POWERMIC_4;
      }
      return DeviceType.UNKNOWN;
    } else if (this.hidDevice.vendorId === 0x0911) {
      return this.deviceCode;
    }
    return DeviceType.UNKNOWN;
  }

  async setSimpleLedState(simpleLedState: SimpleLedState) {
    this.ledState = {...SIMPLE_LED_STATES[simpleLedState]};
    await this.sendLedState();
  }

  async setLed(index: LedIndex, mode: LedMode) {
    this.ledState[index] = mode;
    await this.sendLedState();
  }

  protected async sendLedState() {
    const input = [0, 0, 0, 0, 0, 0, 0, 0];

    input[5] |= this.ledState[LedIndex.RECORD_LED_GREEN] << 0;
    input[5] |= this.ledState[LedIndex.RECORD_LED_RED] << 2;
    input[5] |= this.ledState[LedIndex.INSTRUCTION_LED_GREEN] << 4;
    input[5] |= this.ledState[LedIndex.INSTRUCTION_LED_RED] << 6;

    input[6] |= this.ledState[LedIndex.INS_OWR_BUTTON_LED_GREEN] << 4;
    input[6] |= this.ledState[LedIndex.INS_OWR_BUTTON_LED_RED] << 6;

    input[7] |= this.ledState[LedIndex.F4_BUTTON_LED] << 0;
    input[7] |= this.ledState[LedIndex.F3_BUTTON_LED] << 2;
    input[7] |= this.ledState[LedIndex.F2_BUTTON_LED] << 4;
    input[7] |= this.ledState[LedIndex.F1_BUTTON_LED] << 6;
    await this.sendCommand(Command.SET_LED, input);
  }

  // See comment in DictationDeviceManager
  assignProxyDevice(proxyDevice: SpeechMikeGamepadDevice) {
    if (this.proxyDevice !== undefined) {
      throw new Error(
          'Proxy device already assigned. Adding multiple SpeechMikes in Browser/Gamepad mode at the same time is not supported.');
    }
    this.proxyDevice = proxyDevice;
    this.proxyDevice.addButtonEventListener(
        (_device: DictationDevice, bitMask: ButtonEvent) =>
            this.onProxyButtonEvent(bitMask));
  }

  // See comment in DictationDeviceManager
  protected async onProxyButtonEvent(bitMask: ButtonEvent) {
    await Promise.all([...this.buttonEventListeners].map(
        listener => listener(this.getThisAsDictationDevice(), bitMask)));
  }

  protected async handleCommandResponse(command: Command, data: DataView) {
    const resolve = this.commandResolvers.get(command);
    if (resolve === undefined) {
      throw new Error(`Unexpected response for command ${command}`);
    }
    resolve(data);
  }

  async getEventMode(): Promise<EventMode> {
    const response =
        await this.sendCommandAndWaitForResponse(Command.GET_EVENT_MODE);
    const eventMode = response.getInt8(8);
    return eventMode;
  }

  async setEventMode(eventMode: EventMode) {
    const input = [0, 0, 0, 0, 0, 0, 0, eventMode];
    await this.sendCommand(Command.SET_EVENT_MODE, input);
  }

  protected async fetchDeviceCode() {
    let response =
        await this.sendCommandAndWaitForResponse(Command.IS_SPEECHMIKE_PREMIUM);

    if (response.getUint8(8) & 0x80) {
      // SpeechMike Premium or later. Let´s check whether it´s a SpeechOne,
      // or get the device code otherwise
      response =
          await this.sendCommandAndWaitForResponse(Command.GET_DEVICE_CODE_SMP);

      if (response.getUint8(1)) {
        // SpeechOne or later. We look for the device code somewhere else
        response = await this.sendCommandAndWaitForResponse(
            Command.GET_DEVICE_CODE_SO);
        // get SpeechOne device code
        this.deviceCode = response.getUint16(7);

      } else {
        // get SpeechMike Premium/Touch/Air device code
        const smpaCode = response.getUint16(2);
        const smptCode = response.getUint16(4);
        const smpCode = response.getUint16(6);

        this.deviceCode = Math.max(smpCode, smptCode, smpaCode);

        // if the device is SpeechMike Premium Air, then check for the Ambient
        if ([
              DeviceType.SPEECHMIKE_SMP_4000, DeviceType.SPEECHMIKE_SMP_4010
            ].includes(this.deviceCode)) {
          // first check the main firmware version, it will be 6 or higher for
          // Ambient
          response = await this.sendCommandAndWaitForResponse(
              Command.GET_FIRMWARE_VERSION);
          if (response.getUint8(5) === 6) {
            // we can now get the Ambient device code
            response = await this.sendCommandAndWaitForResponse(
                Command.GET_DEVICE_CODE_SO);
            const SMAmbientDeviceCode = response.getUint16(5);
            if (SMAmbientDeviceCode !== 0) {
              // use the SpeechMike Ambient device code
              this.deviceCode = SMAmbientDeviceCode;
            }
          }
        }
      }
    } else {
      response =
          await this.sendCommandAndWaitForResponse(Command.GET_DEVICE_CODE_SM3);
      // get SpeechMike 3 device code
      this.deviceCode = response.getUint16(7);
    }
  }

  protected determineSliderBitsFilter() {
    if (PHI_SLIDERS.includes(this.deviceCode)) {
      this.sliderBitsFilter = ButtonEvent.FORWARD + ButtonEvent.STOP +
          ButtonEvent.PLAY + ButtonEvent.REWIND;
    } else if (INT_SLIDERS.includes(this.deviceCode)) {
      // INT slider
      this.sliderBitsFilter = ButtonEvent.RECORD + ButtonEvent.STOP +
          ButtonEvent.PLAY + ButtonEvent.REWIND;
    }
  }

  protected override async onInputReport(event: HIDInputReportEvent) {
    const data = event.data;
    const command = data.getUint8(0);

    if (command === Command.BUTTON_PRESS_EVENT) {
      await this.handleButtonPress(data);
    } else if (command === Command.MOTION_EVENT) {
      await this.handleMotionEvent(data);
    } else if (command === Command.WIRELESS_STATUS_EVENT) {
      // Do nothing
      // Bytes 5 & 6 contain information about wireless/battery/charging state.
    } else if (this.commandResolvers.get(command) !== undefined) {
      await this.handleCommandResponse(command, data);
    } else {
      throw new Error(`Unhandled input report from command ${command}`);
    }
  }

  protected getButtonMappings(): Map<ButtonEvent, number> {
    if (this.hidDevice.vendorId === 0x0554 &&
        this.hidDevice.productId === 0x0064) {
      return BUTTON_MAPPINGS_POWERMIC_4;
    }
    return BUTTON_MAPPINGS_SPEECHMIKE;
  }

  protected getInputBitmask(data: DataView): number {
    return data.getUint16(7, /* littleEndian= */ true);
  }

  protected getThisAsDictationDevice(): SpeechMikeHidDevice {
    return this;
  }

  protected async handleMotionEvent(data: DataView) {
    const inputBitMask = data.getUint8(8);
    const motionEvent =
        inputBitMask === 1 ? MotionEvent.LAYED_DOWN : MotionEvent.PICKED_UP;

    await Promise.all([...this.motionEventListeners].map(
        listener => listener(this.getThisAsDictationDevice(), motionEvent)));
  }

  protected async sendCommand(command: Command, input?: number[]) {
    const data = input === undefined ? new Uint8Array([command]) :
                                       new Uint8Array([command, ...input]);
    await this.hidDevice.sendReport(/* reportId= */ 0, data);
  }

  protected async sendCommandAndWaitForResponse(
      command: Command, input?: number[]): Promise<DataView> {
    if (this.commandResolvers.has(command) ||
        this.commandTimeouts.has(command)) {
      throw new Error(`Command ${command} is already running`);
    }

    const responsePromise = new Promise<DataView>(resolve => {
      this.commandResolvers.set(command, resolve);
      this.sendCommand(command, input);
    });
    const timeoutPromise = new Promise<undefined>(resolve => {
      const timeoutId = window.setTimeout(() => {
        resolve(undefined);
      }, COMMAND_TIMEOUT_MS);
      this.commandTimeouts.set(command, timeoutId);
    });

    const result = await Promise.race([responsePromise, timeoutPromise]);

    this.commandResolvers.delete(command);
    this.commandTimeouts.delete(command);

    if (result === undefined) {
      throw new Error(
          `Command ${command} timed out after ${COMMAND_TIMEOUT_MS}ms`);
    }

    return result;
  }

  // For slider SpeechMikes the slider position is always added to any
  // non-slider button event (2 bits set in the bitmask in this case). We
  // don´t need that, so we unset the slider position bit
  protected override filterOutputBitMask(outputBitMask: number): number {
    // Return unfiltered bitmask if the device is not a slider device.
    if (!this.sliderBitsFilter) return outputBitMask;

    const buttonBitsFilter = ~this.sliderBitsFilter;

    const sliderValue = outputBitMask & this.sliderBitsFilter;
    const buttonValue = outputBitMask & buttonBitsFilter;

    const sliderChanged = sliderValue !== this.lastSliderValue;
    const buttonChanged = buttonValue !== this.lastButtonValue;

    this.lastSliderValue = sliderValue;
    this.lastButtonValue = buttonValue;

    if (sliderChanged && buttonChanged) {
      // This can only happen with the first button event, in which case we only
      // care about the button event.
      return outputBitMask & buttonBitsFilter;
    } else if (sliderChanged) {
      // Only return slider bits
      return outputBitMask & this.sliderBitsFilter;
    } else if (buttonChanged) {
      // Only return button bits
      return outputBitMask & buttonBitsFilter;
    }

    return outputBitMask;
  }
}
