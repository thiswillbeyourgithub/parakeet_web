import {ButtonEvent, DeviceType, ImplementationType} from './dictation_device_base';
import {SpeechMikeGamepadDevice} from './speechmike_gamepad_device';
import {ButtonMappingTestCase, checkButtonMapping} from './test_util/check_button_mapping';
import {cleanState} from './test_util/clean_state';
import {FakeHidDevice} from './test_util/fake_hid_device';

describe('SpeechMikeGamepadDevice', () => {
  const state = cleanState<{
    buttonEventListener: jasmine.Spy,
    dictationDevice: SpeechMikeGamepadDevice,
    fakeHidDevice: FakeHidDevice,
  }>();

  beforeEach(() => {
    state.buttonEventListener = jasmine.createSpy('buttonEventListener');
  });

  async function createDictationDevice(
      properties: {vendorId: number, productId: number}) {
    state.fakeHidDevice = new FakeHidDevice(properties);
    state.dictationDevice = SpeechMikeGamepadDevice.create(state.fakeHidDevice);
    state.dictationDevice.addButtonEventListener(state.buttonEventListener);
    await state.dictationDevice.init();
  }

  describe('creates the right device type', () => {
    it('SpeechMikes', async () => {
      await createDictationDevice({vendorId: 0x0911, productId: 0x0fa0});
      expect(state.dictationDevice.getDeviceType()).toBe(DeviceType.UNKNOWN);
      expect(state.dictationDevice.implType)
          .toBe(ImplementationType.SPEECHMIKE_GAMEPAD);
    });

    it('PowerMic4', async () => {
      await createDictationDevice({vendorId: 0x0554, productId: 0x0064});
      expect(state.dictationDevice.getDeviceType()).toBe(DeviceType.UNKNOWN);
      expect(state.dictationDevice.implType)
          .toBe(ImplementationType.SPEECHMIKE_GAMEPAD);
    });
  });

  describe('handles input reports', () => {
    it('SpeechMikes', async () => {
      await createDictationDevice({vendorId: 0x0911, productId: 0x0fa0});

      const testCases: ButtonMappingTestCase[] = [
        {inputReportData: [0, 0], expectedButtonEvents: undefined},
        {inputReportData: [1, 0], expectedButtonEvents: ButtonEvent.REWIND},
        {inputReportData: [2, 0], expectedButtonEvents: ButtonEvent.PLAY},
        {inputReportData: [4, 0], expectedButtonEvents: ButtonEvent.FORWARD},
        {inputReportData: [8, 0], expectedButtonEvents: undefined},
        {inputReportData: [16, 0], expectedButtonEvents: ButtonEvent.INS_OVR},
        {inputReportData: [32, 0], expectedButtonEvents: ButtonEvent.RECORD},
        {inputReportData: [64, 0], expectedButtonEvents: ButtonEvent.COMMAND},
        {inputReportData: [128, 0], expectedButtonEvents: undefined},
        {inputReportData: [0, 1], expectedButtonEvents: undefined},
        {inputReportData: [0, 2], expectedButtonEvents: ButtonEvent.INSTR},
        {inputReportData: [0, 4], expectedButtonEvents: ButtonEvent.F1_A},
        {inputReportData: [0, 8], expectedButtonEvents: ButtonEvent.F2_B},
        {inputReportData: [0, 16], expectedButtonEvents: ButtonEvent.F3_C},
        {inputReportData: [0, 32], expectedButtonEvents: ButtonEvent.F4_D},
        {inputReportData: [0, 64], expectedButtonEvents: ButtonEvent.EOL_PRIO},
        {inputReportData: [0, 128], expectedButtonEvents: undefined},
      ];
      const resetButtonInputReport = [0, 0];
      await checkButtonMapping(
          state.fakeHidDevice, state.dictationDevice, state.buttonEventListener,
          testCases, resetButtonInputReport);
    });

    it('PowerMic4', async () => {
      await createDictationDevice({vendorId: 0x0554, productId: 0x0064});

      const testCases: ButtonMappingTestCase[] = [
        {inputReportData: [0, 0], expectedButtonEvents: undefined},
        {
          inputReportData: [1, 0],
          expectedButtonEvents: ButtonEvent.TAB_BACKWARD
        },
        {inputReportData: [2, 0], expectedButtonEvents: ButtonEvent.PLAY},
        {
          inputReportData: [4, 0],
          expectedButtonEvents: ButtonEvent.TAB_FORWARD
        },
        {inputReportData: [8, 0], expectedButtonEvents: undefined},
        {inputReportData: [16, 0], expectedButtonEvents: ButtonEvent.FORWARD},
        {inputReportData: [32, 0], expectedButtonEvents: ButtonEvent.RECORD},
        {inputReportData: [64, 0], expectedButtonEvents: ButtonEvent.COMMAND},
        {inputReportData: [128, 0], expectedButtonEvents: undefined},
        {inputReportData: [0, 1], expectedButtonEvents: undefined},
        {
          inputReportData: [0, 2],
          expectedButtonEvents: ButtonEvent.ENTER_SELECT
        },
        {inputReportData: [0, 4], expectedButtonEvents: ButtonEvent.F1_A},
        {inputReportData: [0, 8], expectedButtonEvents: ButtonEvent.F2_B},
        {inputReportData: [0, 16], expectedButtonEvents: ButtonEvent.F3_C},
        {inputReportData: [0, 32], expectedButtonEvents: ButtonEvent.F4_D},
        {inputReportData: [0, 64], expectedButtonEvents: ButtonEvent.REWIND},
        {inputReportData: [0, 128], expectedButtonEvents: undefined},
      ];
      const resetButtonInputReport = [0, 0];
      await checkButtonMapping(
          state.fakeHidDevice, state.dictationDevice, state.buttonEventListener,
          testCases, resetButtonInputReport);
    });
  });
});
