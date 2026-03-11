import {ButtonEvent, DeviceType, ImplementationType} from './dictation_device_base';
import {FootControlDevice} from './foot_control_device';
import {ButtonMappingTestCase, checkButtonMapping} from './test_util/check_button_mapping';
import {cleanState} from './test_util/clean_state';
import {FakeHidDevice} from './test_util/fake_hid_device';

describe('FootControlDevice', () => {
  const state = cleanState<{
    buttonEventListener: jasmine.Spy,
    dictationDevice: FootControlDevice,
    fakeHidDevice: FakeHidDevice,
  }>();

  beforeEach(() => {
    state.buttonEventListener = jasmine.createSpy('buttonEventListener');
  });

  async function createDictationDevice(productId: number) {
    state.fakeHidDevice = new FakeHidDevice({productId, vendorId: 0x0911});
    state.dictationDevice = FootControlDevice.create(state.fakeHidDevice);
    state.dictationDevice.addButtonEventListener(state.buttonEventListener);
    await state.dictationDevice.init();
  }

  describe('creates the right device type', () => {
    it('FOOT_CONTROL_ACC_2310_2320', async () => {
      await createDictationDevice(/* productId= */ 0x1844);
      expect(state.dictationDevice.getDeviceType())
          .toBe(DeviceType.FOOT_CONTROL_ACC_2310_2320);
      expect(state.dictationDevice.implType)
          .toBe(ImplementationType.FOOT_CONTROL);
    });

    it('FOOT_CONTROL_ACC_2330', async () => {
      await createDictationDevice(/* productId= */ 0x091a);
      expect(state.dictationDevice.getDeviceType())
          .toBe(DeviceType.FOOT_CONTROL_ACC_2330);
      expect(state.dictationDevice.implType)
          .toBe(ImplementationType.FOOT_CONTROL);
    });
  });

  it('handles input reports', async () => {
    await createDictationDevice(/* productId= */ 0x1844);

    const testCases: ButtonMappingTestCase[] = [
      {inputReportData: [0], expectedButtonEvents: undefined},
      {inputReportData: [1], expectedButtonEvents: ButtonEvent.REWIND},
      {inputReportData: [2], expectedButtonEvents: ButtonEvent.PLAY},
      {inputReportData: [4], expectedButtonEvents: ButtonEvent.FORWARD},
      {inputReportData: [8], expectedButtonEvents: ButtonEvent.EOL_PRIO},
      {inputReportData: [16], expectedButtonEvents: undefined},
    ];
    const resetButtonInputReport = [0];
    await checkButtonMapping(
        state.fakeHidDevice, state.dictationDevice, state.buttonEventListener,
        testCases, resetButtonInputReport);
  });
});
