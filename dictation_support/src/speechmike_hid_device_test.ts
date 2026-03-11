import {ButtonEvent, ButtonEventListener, DeviceType, ImplementationType} from './dictation_device_base';
import {SpeechMikeGamepadDevice} from './speechmike_gamepad_device';
import {LedIndex, LedMode, MotionEvent, SimpleLedState, SpeechMikeHidDevice} from './speechmike_hid_device';
import {ButtonMappingTestCase, checkButtonMapping} from './test_util/check_button_mapping';
import {cleanState} from './test_util/clean_state';
import {FakeHidDevice} from './test_util/fake_hid_device';

describe('SpeechMikeHidDevice', () => {
  const state = cleanState<{
    buttonEventListener: jasmine.Spy,
    dictationDevice: SpeechMikeHidDevice,
    fakeHidDevice: FakeHidDevice,
    motionEventListener: jasmine.Spy,
    proxyDicationDevice: jasmine.SpyObj<SpeechMikeGamepadDevice>,
    proxyDicationDeviceButtonEventListeners: Set<ButtonEventListener>,
    sendReportReceiver: jasmine.Spy,
  }>();

  beforeEach(() => {
    state.buttonEventListener = jasmine.createSpy('buttonEventListener');
    state.motionEventListener = jasmine.createSpy('motionEventListener');
    state.sendReportReceiver = jasmine.createSpy('sendReportReceiver');
    state.sendReportReceiver.and.resolveTo();

    state.proxyDicationDevice =
        jasmine.createSpyObj<SpeechMikeGamepadDevice>('proxyDicationDevice', [
          'addButtonEventListener',
          'shutdown',
        ]);
    state.proxyDicationDeviceButtonEventListeners =
        new Set<ButtonEventListener>();
    state.proxyDicationDevice.addButtonEventListener.and.callFake(
        (listener: ButtonEventListener) => {
          state.proxyDicationDeviceButtonEventListeners.add(listener);
        });
  });

  async function createDictationDevice(
      properties: {vendorId: number, productId: number}) {
    state.fakeHidDevice = new FakeHidDevice(
        {...properties, sendReportReceiver: state.sendReportReceiver});
    state.dictationDevice = SpeechMikeHidDevice.create(state.fakeHidDevice);
    state.dictationDevice.addButtonEventListener(state.buttonEventListener);
    state.dictationDevice.addMotionEventListener(state.motionEventListener);
    state.dictationDevice.assignProxyDevice(state.proxyDicationDevice);
  }

  function prepareResponse(request: number[], response: number[]) {
    state.sendReportReceiver
        .withArgs(/* reportId= */ 0, new Uint8Array(request))
        .and.callFake(() => {
          state.fakeHidDevice.handleInputReport(response);
        });
  }

  async function createDictationDeviceForType(deviceType: DeviceType) {
    switch (deviceType) {
      case DeviceType.SPEECHMIKE_LFH_3200: {
        await createDictationDevice({vendorId: 0x0911, productId: 0x0c1c});
        prepareResponse([131], [131, 2, 0, 0, 0, 0, 50, 0, 85]);  // IS_PREMIUM
        prepareResponse(
            [135], [135, 0, 0, 0, 0, 0, 0, 12, 128]);  // GET_DEVICE_CODE_SM3
        break;
      }
      case DeviceType.SPEECHMIKE_LFH_3210: {
        await createDictationDevice({vendorId: 0x0911, productId: 0x0c1c});
        prepareResponse([131], [131, 2, 0, 0, 0, 0, 50, 0, 85]);  // IS_PREMIUM
        prepareResponse(
            [135], [135, 0, 0, 0, 0, 0, 0, 12, 138]);  // GET_DEVICE_CODE_SM3
        break;
      }
      case DeviceType.SPEECHMIKE_LFH_3220: {
        await createDictationDevice({vendorId: 0x0911, productId: 0x0c1c});
        prepareResponse([131], [131, 2, 0, 0, 0, 0, 50, 0, 85]);  // IS_PREMIUM
        prepareResponse(
            [135], [135, 0, 0, 0, 0, 0, 0, 12, 148]);  // GET_DEVICE_CODE_SM3
        break;
      }
      case DeviceType.SPEECHMIKE_LFH_3300: {
        await createDictationDevice({vendorId: 0x0911, productId: 0x0c1c});
        prepareResponse([131], [131, 2, 0, 0, 0, 0, 50, 0, 85]);  // IS_PREMIUM
        prepareResponse(
            [135], [135, 0, 0, 0, 0, 0, 0, 12, 228]);  // GET_DEVICE_CODE_SM3
        break;
      }
      case DeviceType.SPEECHMIKE_LFH_3310: {
        await createDictationDevice({vendorId: 0x0911, productId: 0x0c1c});
        prepareResponse([131], [131, 2, 0, 0, 0, 0, 50, 0, 85]);  // IS_PREMIUM
        prepareResponse(
            [135], [135, 0, 0, 0, 0, 0, 0, 12, 238]);  // GET_DEVICE_CODE_SM3
        break;
      }
      case DeviceType.SPEECHMIKE_LFH_3500: {
        await createDictationDevice({vendorId: 0x0911, productId: 0x0c1c});
        prepareResponse([131], [131, 0, 0, 0, 1, 0, 50, 1, 149]);  // IS_PREMIUM
        prepareResponse(
            [139], [139, 0, 0, 0, 0, 0, 13, 172, 0]);  // GET_DEVICE_CODE_SMP
        break;
      }
      case DeviceType.SPEECHMIKE_LFH_3510: {
        await createDictationDevice({vendorId: 0x0911, productId: 0x0c1c});
        prepareResponse([131], [131, 0, 0, 0, 1, 0, 50, 1, 149]);  // IS_PREMIUM
        prepareResponse(
            [139], [139, 0, 0, 0, 0, 0, 13, 182, 0]);  // GET_DEVICE_CODE_SMP
        break;
      }
      case DeviceType.SPEECHMIKE_LFH_3520: {
        await createDictationDevice({vendorId: 0x0911, productId: 0x0c1c});
        prepareResponse([131], [131, 0, 0, 0, 1, 0, 50, 1, 149]);  // IS_PREMIUM
        prepareResponse(
            [139], [139, 0, 0, 0, 0, 0, 13, 192, 0]);  // GET_DEVICE_CODE_SMP
        break;
      }
      case DeviceType.SPEECHMIKE_LFH_3600: {
        await createDictationDevice({vendorId: 0x0911, productId: 0x0c1c});
        prepareResponse([131], [131, 0, 0, 0, 1, 0, 50, 1, 149]);  // IS_PREMIUM
        prepareResponse(
            [139], [139, 0, 0, 0, 0, 0, 14, 16, 0]);  // GET_DEVICE_CODE_SMP
        break;
      }
      case DeviceType.SPEECHMIKE_LFH_3610: {
        await createDictationDevice({vendorId: 0x0911, productId: 0x0c1c});
        prepareResponse([131], [131, 0, 0, 0, 1, 0, 50, 1, 149]);  // IS_PREMIUM
        prepareResponse(
            [139], [139, 0, 0, 0, 0, 0, 14, 26, 0]);  // GET_DEVICE_CODE_SMP
        break;
      }
      case DeviceType.SPEECHMIKE_SMP_3700: {
        await createDictationDevice({vendorId: 0x0911, productId: 0x0c1c});
        prepareResponse([131], [131, 0, 0, 0, 1, 0, 50, 1, 149]);  // IS_PREMIUM
        prepareResponse(
            [139], [139, 0, 0, 0, 0, 0, 14, 116, 0]);  // GET_DEVICE_CODE_SMP
        break;
      }
      case DeviceType.SPEECHMIKE_SMP_3710: {
        await createDictationDevice({vendorId: 0x0911, productId: 0x0c1c});
        prepareResponse([131], [131, 0, 0, 0, 1, 0, 50, 1, 149]);  // IS_PREMIUM
        prepareResponse(
            [139], [139, 0, 0, 0, 0, 0, 14, 126, 0]);  // GET_DEVICE_CODE_SMP
        break;
      }
      case DeviceType.SPEECHMIKE_SMP_3720: {
        await createDictationDevice({vendorId: 0x0911, productId: 0x0c1c});
        prepareResponse([131], [131, 0, 0, 0, 1, 0, 50, 1, 149]);  // IS_PREMIUM
        prepareResponse(
            [139], [139, 0, 0, 0, 0, 0, 14, 136, 0]);  // GET_DEVICE_CODE_SMP
        break;
      }
      case DeviceType.SPEECHMIKE_SMP_3800: {
        await createDictationDevice({vendorId: 0x0911, productId: 0x0c1c});
        prepareResponse([131], [131, 0, 0, 0, 1, 0, 50, 1, 149]);  // IS_PREMIUM
        prepareResponse(
            [139], [139, 0, 0, 0, 14, 216, 14, 16, 0]);  // GET_DEVICE_CODE_SMP
        break;
      }
      case DeviceType.SPEECHMIKE_SMP_3810: {
        await createDictationDevice({vendorId: 0x0911, productId: 0x0c1c});
        prepareResponse([131], [131, 0, 0, 0, 1, 0, 50, 1, 149]);  // IS_PREMIUM
        prepareResponse(
            [139], [139, 0, 0, 0, 14, 226, 14, 26, 0]);  // GET_DEVICE_CODE_SMP
        break;
      }
      case DeviceType.SPEECHMIKE_SMP_4000: {
        await createDictationDevice({vendorId: 0x0911, productId: 0x0c1d});
        prepareResponse([131], [131, 0, 0, 0, 1, 0, 50, 1, 149]);  // IS_PREMIUM
        prepareResponse(
            [139],
            [139, 0, 15, 160, 14, 116, 13, 172, 0]);  // GET_DEVICE_CODE_SMP
        prepareResponse(
            [145], [145, 0, 0, 65, 65, 4, 46, 0, 65])  // GET_FIRMWARE_VERSION
        break;
      }
      case DeviceType.SPEECHMIKE_SMP_4010: {
        await createDictationDevice({vendorId: 0x0911, productId: 0x0c1d});
        prepareResponse([131], [131, 0, 0, 0, 1, 0, 50, 1, 149]);  // IS_PREMIUM
        prepareResponse(
            [139],
            [139, 0, 15, 170, 14, 126, 13, 182, 0]);  // GET_DEVICE_CODE_SMP
        prepareResponse(
            [145], [145, 0, 0, 65, 65, 4, 46, 0, 65])  // GET_FIRMWARE_VERSION
        break;
      }
      case DeviceType.SPEECHONE_PSM_6000: {
        await createDictationDevice({vendorId: 0x0911, productId: 0x0c1e});
        prepareResponse([131], [131, 0, 0, 0, 1, 0, 50, 1, 149]);  // IS_PREMIUM
        prepareResponse(
            [139],
            [139, 1, 15, 160, 14, 116, 13, 172, 0]);  // GET_DEVICE_CODE_SMP
        prepareResponse(
            [150], [150, 0, 0, 0, 0, 0, 0, 23, 113]);  // GET_DEVICE_CODE_SO
        break;
      }
      case DeviceType.POWERMIC_4: {
        await createDictationDevice({vendorId: 0x0554, productId: 0x0064});
        prepareResponse([131], [131, 0, 0, 0, 1, 0, 50, 1, 149]);  // IS_PREMIUM
        prepareResponse(
            [139], [139, 0, 0, 0, 14, 116, 13, 172, 0]);  // GET_DEVICE_CODE_SMP
        break;
      }
      case DeviceType.SPEECHMIKE_AMBIENT_PSM5000: {
        await createDictationDevice({vendorId: 0x0911, productId: 0x0c1e});
        prepareResponse([131], [131, 0, 0, 0, 1, 0, 50, 1, 149]);  // IS_PREMIUM
        prepareResponse(
            [139],
            [139, 0, 15, 160, 14, 116, 13, 172, 0]);  // GET_DEVICE_CODE_SMP
        prepareResponse(
            [145], [145, 0, 0, 5, 7, 6, 46, 0, 7])  // GET_FIRMWARE_VERSION
        prepareResponse(
            [150], [150, 0, 0, 0, 0, 19, 136, 0, 0]);  // GET_DEVICE_CODE_SO
        break;
      }
      default: {
        throw new Error(`Unhandled device type ${deviceType}`);
      }
    }
    await state.dictationDevice.init();
  }

  describe('creates the right device type', () => {
    const testCases: DeviceType[] = [
      DeviceType.SPEECHMIKE_LFH_3200, DeviceType.SPEECHMIKE_LFH_3210,
      DeviceType.SPEECHMIKE_LFH_3220, DeviceType.SPEECHMIKE_LFH_3300,
      DeviceType.SPEECHMIKE_LFH_3310, DeviceType.SPEECHMIKE_LFH_3500,
      DeviceType.SPEECHMIKE_LFH_3510, DeviceType.SPEECHMIKE_LFH_3520,
      DeviceType.SPEECHMIKE_LFH_3600, DeviceType.SPEECHMIKE_LFH_3610,
      DeviceType.SPEECHMIKE_SMP_3700, DeviceType.SPEECHMIKE_SMP_3710,
      DeviceType.SPEECHMIKE_SMP_3720, DeviceType.SPEECHMIKE_SMP_3800,
      DeviceType.SPEECHMIKE_SMP_3810, DeviceType.SPEECHMIKE_SMP_4000,
      DeviceType.SPEECHMIKE_SMP_4010, DeviceType.SPEECHONE_PSM_6000,
      DeviceType.POWERMIC_4,          DeviceType.SPEECHMIKE_AMBIENT_PSM5000,
    ];

    for (const deviceType of testCases) {
      it(DeviceType[deviceType], async () => {
        await createDictationDeviceForType(deviceType);
        expect(state.dictationDevice.getDeviceType()).toBe(deviceType);
        expect(state.dictationDevice.implType)
            .toBe(ImplementationType.SPEECHMIKE_HID);
      });
    }
  });

  it('setLed()', async () => {
    await createDictationDeviceForType(DeviceType.SPEECHMIKE_SMP_3700);

    const testCases:
        {index: LedIndex, mode: LedMode, expectedCommandData: number[]}[] = [
          {
            index: LedIndex.RECORD_LED_GREEN,
            mode: LedMode.BLINK_SLOW,
            expectedCommandData: [2, 0, 0, 0, 0, 0, 1, 0, 0]
          },
          {
            index: LedIndex.RECORD_LED_GREEN,
            mode: LedMode.BLINK_FAST,
            expectedCommandData: [2, 0, 0, 0, 0, 0, 2, 0, 0]
          },
          {
            index: LedIndex.RECORD_LED_GREEN,
            mode: LedMode.ON,
            expectedCommandData: [2, 0, 0, 0, 0, 0, 3, 0, 0]
          },
          {
            index: LedIndex.RECORD_LED_RED,
            mode: LedMode.BLINK_SLOW,
            expectedCommandData: [2, 0, 0, 0, 0, 0, 4, 0, 0]
          },
          {
            index: LedIndex.RECORD_LED_RED,
            mode: LedMode.BLINK_FAST,
            expectedCommandData: [2, 0, 0, 0, 0, 0, 8, 0, 0]
          },
          {
            index: LedIndex.RECORD_LED_RED,
            mode: LedMode.ON,
            expectedCommandData: [2, 0, 0, 0, 0, 0, 12, 0, 0]
          },
          {
            index: LedIndex.INSTRUCTION_LED_GREEN,
            mode: LedMode.BLINK_SLOW,
            expectedCommandData: [2, 0, 0, 0, 0, 0, 16, 0, 0]
          },
          {
            index: LedIndex.INSTRUCTION_LED_GREEN,
            mode: LedMode.BLINK_FAST,
            expectedCommandData: [2, 0, 0, 0, 0, 0, 32, 0, 0]
          },
          {
            index: LedIndex.INSTRUCTION_LED_GREEN,
            mode: LedMode.ON,
            expectedCommandData: [2, 0, 0, 0, 0, 0, 48, 0, 0]
          },
          {
            index: LedIndex.INSTRUCTION_LED_RED,
            mode: LedMode.BLINK_SLOW,
            expectedCommandData: [2, 0, 0, 0, 0, 0, 64, 0, 0]
          },
          {
            index: LedIndex.INSTRUCTION_LED_RED,
            mode: LedMode.BLINK_FAST,
            expectedCommandData: [2, 0, 0, 0, 0, 0, 128, 0, 0]
          },
          {
            index: LedIndex.INSTRUCTION_LED_RED,
            mode: LedMode.ON,
            expectedCommandData: [2, 0, 0, 0, 0, 0, 192, 0, 0]
          },
          {
            index: LedIndex.INS_OWR_BUTTON_LED_GREEN,
            mode: LedMode.BLINK_SLOW,
            expectedCommandData: [2, 0, 0, 0, 0, 0, 0, 16, 0]
          },
          {
            index: LedIndex.INS_OWR_BUTTON_LED_GREEN,
            mode: LedMode.BLINK_FAST,
            expectedCommandData: [2, 0, 0, 0, 0, 0, 0, 32, 0]
          },
          {
            index: LedIndex.INS_OWR_BUTTON_LED_GREEN,
            mode: LedMode.ON,
            expectedCommandData: [2, 0, 0, 0, 0, 0, 0, 48, 0]
          },
          {
            index: LedIndex.INS_OWR_BUTTON_LED_RED,
            mode: LedMode.BLINK_SLOW,
            expectedCommandData: [2, 0, 0, 0, 0, 0, 0, 64, 0]
          },
          {
            index: LedIndex.INS_OWR_BUTTON_LED_RED,
            mode: LedMode.BLINK_FAST,
            expectedCommandData: [2, 0, 0, 0, 0, 0, 0, 128, 0]
          },
          {
            index: LedIndex.INS_OWR_BUTTON_LED_RED,
            mode: LedMode.ON,
            expectedCommandData: [2, 0, 0, 0, 0, 0, 0, 192, 0]
          },
          {
            index: LedIndex.F4_BUTTON_LED,
            mode: LedMode.BLINK_SLOW,
            expectedCommandData: [2, 0, 0, 0, 0, 0, 0, 0, 1]
          },
          {
            index: LedIndex.F4_BUTTON_LED,
            mode: LedMode.BLINK_FAST,
            expectedCommandData: [2, 0, 0, 0, 0, 0, 0, 0, 2]
          },
          {
            index: LedIndex.F4_BUTTON_LED,
            mode: LedMode.ON,
            expectedCommandData: [2, 0, 0, 0, 0, 0, 0, 0, 3]
          },
          {
            index: LedIndex.F3_BUTTON_LED,
            mode: LedMode.BLINK_SLOW,
            expectedCommandData: [2, 0, 0, 0, 0, 0, 0, 0, 4]
          },
          {
            index: LedIndex.F3_BUTTON_LED,
            mode: LedMode.BLINK_FAST,
            expectedCommandData: [2, 0, 0, 0, 0, 0, 0, 0, 8]
          },
          {
            index: LedIndex.F3_BUTTON_LED,
            mode: LedMode.ON,
            expectedCommandData: [2, 0, 0, 0, 0, 0, 0, 0, 12]
          },
          {
            index: LedIndex.F2_BUTTON_LED,
            mode: LedMode.BLINK_SLOW,
            expectedCommandData: [2, 0, 0, 0, 0, 0, 0, 0, 16]
          },
          {
            index: LedIndex.F2_BUTTON_LED,
            mode: LedMode.BLINK_FAST,
            expectedCommandData: [2, 0, 0, 0, 0, 0, 0, 0, 32]
          },
          {
            index: LedIndex.F2_BUTTON_LED,
            mode: LedMode.ON,
            expectedCommandData: [2, 0, 0, 0, 0, 0, 0, 0, 48]
          },
          {
            index: LedIndex.F1_BUTTON_LED,
            mode: LedMode.BLINK_SLOW,
            expectedCommandData: [2, 0, 0, 0, 0, 0, 0, 0, 64]
          },
          {
            index: LedIndex.F1_BUTTON_LED,
            mode: LedMode.BLINK_FAST,
            expectedCommandData: [2, 0, 0, 0, 0, 0, 0, 0, 128]
          },
          {
            index: LedIndex.F1_BUTTON_LED,
            mode: LedMode.ON,
            expectedCommandData: [2, 0, 0, 0, 0, 0, 0, 0, 192]
          },
        ];
    for (const testCase of testCases) {
      const contextOn =
          `${LedIndex[testCase.index]} set to ${LedMode[testCase.mode]}`;
      const contextOff =
          `${LedIndex[testCase.index]} set to ${LedMode[LedMode.OFF]}`;

      // Set LED
      state.sendReportReceiver.calls.reset();
      await state.dictationDevice.setLed(testCase.index, testCase.mode);
      expect(state.sendReportReceiver)
          .withContext(contextOn)
          .toHaveBeenCalledOnceWith(
              /* reportId= */ 0, new Uint8Array(testCase.expectedCommandData));

      // Turn off LED
      state.sendReportReceiver.calls.reset();
      await state.dictationDevice.setLed(testCase.index, LedMode.OFF);
      expect(state.sendReportReceiver)
          .withContext(contextOff)
          .toHaveBeenCalledOnceWith(
              /* reportId= */ 0, new Uint8Array([2, 0, 0, 0, 0, 0, 0, 0, 0]));
    }
  });

  it('setSimpleLedState()', async () => {
    await createDictationDeviceForType(DeviceType.SPEECHMIKE_SMP_3700);

    const testCases: {state: SimpleLedState, expectedCommandData: number[]}[] =
        [
          {
            state: SimpleLedState.OFF,
            expectedCommandData: [2, 0, 0, 0, 0, 0, 0, 0, 0]
          },
          {
            state: SimpleLedState.RECORD_INSERT,
            expectedCommandData: [2, 0, 0, 0, 0, 0, 3, 48, 0]
          },
          {
            state: SimpleLedState.RECORD_OVERWRITE,
            expectedCommandData: [2, 0, 0, 0, 0, 0, 12, 0, 0]
          },
          {
            state: SimpleLedState.RECORD_STANDBY_INSERT,
            expectedCommandData: [2, 0, 0, 0, 0, 0, 1, 16, 0]
          },
          {
            state: SimpleLedState.RECORD_STANDBY_OVERWRITE,
            expectedCommandData: [2, 0, 0, 0, 0, 0, 4, 0, 0]
          },
        ];
    for (const testCase of testCases) {
      state.sendReportReceiver.calls.reset();
      await state.dictationDevice.setSimpleLedState(testCase.state);
      expect(state.sendReportReceiver)
          .withContext(SimpleLedState[testCase.state])
          .toHaveBeenCalledOnceWith(
              /* reportId= */ 0, new Uint8Array(testCase.expectedCommandData));
    }
  });

  it('handles motion events', async () => {
    await createDictationDeviceForType(DeviceType.SPEECHMIKE_SMP_3700);

    expect(state.motionEventListener).not.toHaveBeenCalled();

    // PICKED_UP
    await state.fakeHidDevice.handleInputReport([158, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(state.motionEventListener)
        .toHaveBeenCalledOnceWith(state.dictationDevice, MotionEvent.PICKED_UP);
    state.motionEventListener.calls.reset();

    // LAYED_DOWN
    await state.fakeHidDevice.handleInputReport([158, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(state.motionEventListener)
        .toHaveBeenCalledOnceWith(
            state.dictationDevice, MotionEvent.LAYED_DOWN);
  });

  describe('handles input reports', () => {
    it('SpeechMikes_Pro', async () => {
      await createDictationDeviceForType(DeviceType.SPEECHMIKE_SMP_3700);

      const testCases: ButtonMappingTestCase[] = [
        {
          inputReportData: [128, 0, 0, 0, 0, 0, 0, 1, 0],
          expectedButtonEvents: ButtonEvent.SCAN_END
        },
        {
          inputReportData: [128, 0, 0, 0, 0, 0, 0, 2, 0],
          expectedButtonEvents: ButtonEvent.F1_A
        },
        {
          inputReportData: [128, 0, 0, 0, 0, 0, 0, 4, 0],
          expectedButtonEvents: ButtonEvent.F2_B
        },
        {
          inputReportData: [128, 0, 0, 0, 0, 0, 0, 8, 0],
          expectedButtonEvents: ButtonEvent.F3_C
        },
        {
          inputReportData: [128, 0, 0, 0, 0, 0, 0, 16, 0],
          expectedButtonEvents: ButtonEvent.F4_D
        },
        {
          inputReportData: [128, 0, 0, 0, 0, 0, 0, 32, 0],
          expectedButtonEvents: ButtonEvent.COMMAND
        },
        {
          inputReportData: [128, 0, 0, 0, 0, 0, 0, 64, 0],
          expectedButtonEvents: undefined
        },
        {
          inputReportData: [128, 0, 0, 0, 0, 0, 0, 128, 0],
          expectedButtonEvents: ButtonEvent.SCAN_SUCCESS
        },
        {
          inputReportData: [128, 0, 0, 0, 0, 0, 0, 0, 1],
          expectedButtonEvents: ButtonEvent.RECORD
        },
        {
          inputReportData: [128, 0, 0, 0, 0, 0, 0, 0, 2],
          expectedButtonEvents: ButtonEvent.STOP
        },
        {
          inputReportData: [128, 0, 0, 0, 0, 0, 0, 0, 4],
          expectedButtonEvents: ButtonEvent.PLAY
        },
        {
          inputReportData: [128, 0, 0, 0, 0, 0, 0, 0, 8],
          expectedButtonEvents: ButtonEvent.FORWARD
        },
        {
          inputReportData: [128, 0, 0, 0, 0, 0, 0, 0, 16],
          expectedButtonEvents: ButtonEvent.REWIND
        },
        {
          inputReportData: [128, 0, 0, 0, 0, 0, 0, 0, 32],
          expectedButtonEvents: ButtonEvent.EOL_PRIO
        },
        {
          inputReportData: [128, 0, 0, 0, 0, 0, 0, 0, 64],
          expectedButtonEvents: ButtonEvent.INS_OVR
        },
        {
          inputReportData: [128, 0, 0, 0, 0, 0, 0, 0, 128],
          expectedButtonEvents: ButtonEvent.INSTR
        },
      ];
      const resetButtonInputReport = [128, 0, 0, 0, 0, 0, 0, 0, 0];
      await checkButtonMapping(
          state.fakeHidDevice, state.dictationDevice, state.buttonEventListener,
          testCases, resetButtonInputReport);
    });

    describe('SpeechMikes_INTSlider', () => {
      beforeEach(async () => {
        await createDictationDeviceForType(DeviceType.SPEECHMIKE_SMP_3710);
      });

      it('Buttons', async () => {
        const testCases: ButtonMappingTestCase[] = [
          {
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 1, 0],
            expectedButtonEvents: ButtonEvent.SCAN_END
          },
          {
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 2, 0],
            expectedButtonEvents: ButtonEvent.F1_A
          },
          {
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 4, 0],
            expectedButtonEvents: ButtonEvent.F2_B
          },
          {
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 8, 0],
            expectedButtonEvents: ButtonEvent.F3_C
          },
          {
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 16, 0],
            expectedButtonEvents: ButtonEvent.F4_D
          },
          {
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 32, 0],
            expectedButtonEvents: ButtonEvent.COMMAND
          },
          {
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 64, 0],
            expectedButtonEvents: undefined
          },
          {
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 128, 0],
            expectedButtonEvents: ButtonEvent.SCAN_SUCCESS
          },
          {
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 0, 8],
            expectedButtonEvents: ButtonEvent.FORWARD
          },
          {
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 0, 32],
            expectedButtonEvents: ButtonEvent.EOL_PRIO
          },
          {
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 0, 64],
            expectedButtonEvents: ButtonEvent.INS_OVR
          },
          {
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 0, 128],
            expectedButtonEvents: ButtonEvent.INSTR
          },
        ];
        const resetButtonInputReport = [128, 0, 0, 0, 0, 0, 0, 0, 0];
        await checkButtonMapping(
            state.fakeHidDevice, state.dictationDevice,
            state.buttonEventListener, testCases, resetButtonInputReport);
      });

      it('Slider', async () => {
        const testCases: ButtonMappingTestCase[] = [
          {
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 0, 1],
            expectedButtonEvents: ButtonEvent.RECORD
          },
          {
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 0, 2],
            expectedButtonEvents: ButtonEvent.STOP
          },
          {
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 0, 4],
            expectedButtonEvents: ButtonEvent.PLAY
          },
          {
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 0, 16],
            expectedButtonEvents: ButtonEvent.REWIND
          },
        ];
        const resetInputReport = undefined;  // no reset
        await checkButtonMapping(
            state.fakeHidDevice, state.dictationDevice,
            state.buttonEventListener, testCases, resetInputReport);
      });

      it('Slider + Button', async () => {
        const testCases: ButtonMappingTestCase[] = [
          {
            // Button: SCAN_END, Slider: PLAY
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 1, 4],
            expectedButtonEvents: ButtonEvent.SCAN_END
          },
          {
            // Button: None, Slider: PLAY
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 0, 4],
            expectedButtonEvents: ButtonEvent.NONE
          },
          {
            // Button: None, Slider: STOP
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 0, 2],
            expectedButtonEvents: ButtonEvent.STOP
          },
          {
            // Button: F1_A, Slider: STOP
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 2, 2],
            expectedButtonEvents: ButtonEvent.F1_A
          },
        ];
        const resetInputReport = undefined;  // no reset
        await checkButtonMapping(
            state.fakeHidDevice, state.dictationDevice,
            state.buttonEventListener, testCases, resetInputReport);
      });
    });

    describe('SpeechMikes_PHISlider', () => {
      beforeEach(async () => {
        await createDictationDeviceForType(DeviceType.SPEECHMIKE_LFH_3520);
      });

      it('Buttons', async () => {
        const testCases: ButtonMappingTestCase[] = [
          {
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 1, 0],
            expectedButtonEvents: ButtonEvent.SCAN_END
          },
          {
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 2, 0],
            expectedButtonEvents: ButtonEvent.F1_A
          },
          {
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 4, 0],
            expectedButtonEvents: ButtonEvent.F2_B
          },
          {
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 8, 0],
            expectedButtonEvents: ButtonEvent.F3_C
          },
          {
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 16, 0],
            expectedButtonEvents: ButtonEvent.F4_D
          },
          {
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 32, 0],
            expectedButtonEvents: ButtonEvent.COMMAND
          },
          {
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 64, 0],
            expectedButtonEvents: undefined
          },
          {
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 128, 0],
            expectedButtonEvents: ButtonEvent.SCAN_SUCCESS
          },
          {
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 0, 1],
            expectedButtonEvents: ButtonEvent.RECORD
          },
          {
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 0, 32],
            expectedButtonEvents: ButtonEvent.EOL_PRIO
          },
          {
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 0, 64],
            expectedButtonEvents: ButtonEvent.INS_OVR
          },
          {
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 0, 128],
            expectedButtonEvents: ButtonEvent.INSTR
          },
        ];
        const resetButtonInputReport = [128, 0, 0, 0, 0, 0, 0, 0, 0];
        await checkButtonMapping(
            state.fakeHidDevice, state.dictationDevice,
            state.buttonEventListener, testCases, resetButtonInputReport);
      });

      it('Slider', async () => {
        const testCases: ButtonMappingTestCase[] = [
          {
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 0, 8],
            expectedButtonEvents: ButtonEvent.FORWARD
          },
          {
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 0, 2],
            expectedButtonEvents: ButtonEvent.STOP
          },
          {
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 0, 4],
            expectedButtonEvents: ButtonEvent.PLAY
          },
          {
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 0, 16],
            expectedButtonEvents: ButtonEvent.REWIND
          },
        ];
        const resetInputReport = undefined;  // no reset
        await checkButtonMapping(
            state.fakeHidDevice, state.dictationDevice,
            state.buttonEventListener, testCases, resetInputReport);
      });

      it('Slider + Button', async () => {
        const testCases: ButtonMappingTestCase[] = [
          {
            // Button: SCAN_END, Slider: PLAY
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 1, 4],
            expectedButtonEvents: ButtonEvent.SCAN_END
          },
          {
            // Button: None, Slider: PLAY
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 0, 4],
            expectedButtonEvents: ButtonEvent.NONE
          },
          {
            // Button: None, Slider: STOP
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 0, 2],
            expectedButtonEvents: ButtonEvent.STOP
          },
          {
            // Button: F1_A, Slider: STOP
            inputReportData: [128, 0, 0, 0, 0, 0, 0, 2, 2],
            expectedButtonEvents: ButtonEvent.F1_A
          },
        ];
        const resetInputReport = undefined;  // no reset
        await checkButtonMapping(
            state.fakeHidDevice, state.dictationDevice,
            state.buttonEventListener, testCases, resetInputReport);
      });
    });

    it('PowerMic4', async () => {
      await createDictationDeviceForType(DeviceType.POWERMIC_4);

      const testCases: ButtonMappingTestCase[] = [
        {
          inputReportData: [128, 0, 0, 0, 0, 0, 0, 1, 0],
          expectedButtonEvents: undefined
        },
        {
          inputReportData: [128, 0, 0, 0, 0, 0, 0, 2, 0],
          expectedButtonEvents: ButtonEvent.F1_A
        },
        {
          inputReportData: [128, 0, 0, 0, 0, 0, 0, 4, 0],
          expectedButtonEvents: ButtonEvent.F2_B
        },
        {
          inputReportData: [128, 0, 0, 0, 0, 0, 0, 8, 0],
          expectedButtonEvents: ButtonEvent.F3_C
        },
        {
          inputReportData: [128, 0, 0, 0, 0, 0, 0, 16, 0],
          expectedButtonEvents: ButtonEvent.F4_D
        },
        {
          inputReportData: [128, 0, 0, 0, 0, 0, 0, 32, 0],
          expectedButtonEvents: ButtonEvent.COMMAND
        },
        {
          inputReportData: [128, 0, 0, 0, 0, 0, 0, 64, 0],
          expectedButtonEvents: undefined
        },
        {
          inputReportData: [128, 0, 0, 0, 0, 0, 0, 128, 0],
          expectedButtonEvents: undefined
        },
        {
          inputReportData: [128, 0, 0, 0, 0, 0, 0, 0, 1],
          expectedButtonEvents: ButtonEvent.RECORD
        },
        {
          inputReportData: [128, 0, 0, 0, 0, 0, 0, 0, 2],
          expectedButtonEvents: undefined
        },
        {
          inputReportData: [128, 0, 0, 0, 0, 0, 0, 0, 4],
          expectedButtonEvents: ButtonEvent.PLAY
        },
        {
          inputReportData: [128, 0, 0, 0, 0, 0, 0, 0, 8],
          expectedButtonEvents: ButtonEvent.TAB_FORWARD
        },
        {
          inputReportData: [128, 0, 0, 0, 0, 0, 0, 0, 16],
          expectedButtonEvents: ButtonEvent.TAB_BACKWARD
        },
        {
          inputReportData: [128, 0, 0, 0, 0, 0, 0, 0, 32],
          expectedButtonEvents: ButtonEvent.REWIND
        },
        {
          inputReportData: [128, 0, 0, 0, 0, 0, 0, 0, 64],
          expectedButtonEvents: ButtonEvent.FORWARD
        },
        {
          inputReportData: [128, 0, 0, 0, 0, 0, 0, 0, 128],
          expectedButtonEvents: ButtonEvent.ENTER_SELECT
        },
      ];
      const resetButtonInputReport = [128, 0, 0, 0, 0, 0, 0, 0, 0];
      await checkButtonMapping(
          state.fakeHidDevice, state.dictationDevice, state.buttonEventListener,
          testCases, resetButtonInputReport);
    });
  });

  describe('proxy device', () => {
    beforeEach(async () => {
      await createDictationDeviceForType(DeviceType.SPEECHMIKE_SMP_3700);
    });

    it('propagates shutdown signal to proxy device', async () => {
      expect(state.proxyDicationDevice.shutdown).not.toHaveBeenCalled();
      await state.dictationDevice.shutdown();
      expect(state.proxyDicationDevice.shutdown).toHaveBeenCalled();
    });

    it('propagates button press events from proxy device', async () => {
      const button = ButtonEvent.RECORD;
      expect(state.buttonEventListener).not.toHaveBeenCalled();
      await Promise.all([...state.proxyDicationDeviceButtonEventListeners].map(
          listener => listener(state.proxyDicationDevice, button)));
      expect(state.buttonEventListener)
          .toHaveBeenCalledOnceWith(state.dictationDevice, button);
    });
  });
});
