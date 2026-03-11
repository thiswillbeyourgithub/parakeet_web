import {ButtonEvent, DeviceType, DictationDeviceBase, ImplementationType} from './dictation_device_base';
import {FootControlDevice} from './foot_control_device';
import {ButtonMappingTestCase, checkButtonMapping} from './test_util/check_button_mapping';
import {cleanState} from './test_util/clean_state';
import {FakeHidDevice} from './test_util/fake_hid_device';

const BUTTON_MAPPINGS = new Map<ButtonEvent, number>([
  [ButtonEvent.PLAY, 1 << 0],
  [ButtonEvent.RECORD, 1 << 1],
]);

class TestDictationDevice extends DictationDeviceBase {
  readonly implType = ImplementationType.FOOT_CONTROL;

  static create(hidDevice: HIDDevice) {
    return new TestDictationDevice(hidDevice);
  }

  getDeviceType(): DeviceType {
    return DeviceType.UNKNOWN;
  }

  protected getButtonMappings(): Map<ButtonEvent, number> {
    return BUTTON_MAPPINGS;
  }

  protected getInputBitmask(data: DataView): number {
    return data.getUint8(0);
  }

  protected getThisAsDictationDevice(): FootControlDevice {
    // Workaround since TestDictationDevice is actually not a DictationDevice.
    return this as unknown as FootControlDevice;
  }
}

describe('DictationDeviceBase', () => {
  const state = cleanState<{
    buttonEventListener: jasmine.Spy,
    dictationDevice: TestDictationDevice,
    fakeHidDevice: FakeHidDevice,
  }>();

  beforeEach(() => {
    state.buttonEventListener = jasmine.createSpy('buttonEventListener');

    state.fakeHidDevice = new FakeHidDevice({productId: 123, vendorId: 456});
    state.dictationDevice = TestDictationDevice.create(state.fakeHidDevice);
    state.dictationDevice.addButtonEventListener(state.buttonEventListener);
  });

  describe('init()', () => {
    it('opens the device if closed', async () => {
      expect(state.fakeHidDevice.opened).toBe(false);

      await state.dictationDevice.init();
      expect(state.fakeHidDevice.opened).toBe(true);
    });

    it('does not open the device if already opened', async () => {
      await state.fakeHidDevice.open();
      expect(state.fakeHidDevice.opened).toBe(true);

      await state.dictationDevice.init();
      expect(state.fakeHidDevice.opened).toBe(true);
    });
  });

  describe('shutdown()', () => {
    beforeEach(async () => {
      await state.dictationDevice.init();
      expect(state.fakeHidDevice.opened).toBe(true);
    });

    it('closes the device if requested', async () => {
      await state.dictationDevice.shutdown(/*closeDevice=*/ true);
      expect(state.fakeHidDevice.opened).toBe(false);
    });

    it('does not close the device if not requested', async () => {
      await state.dictationDevice.shutdown(/*closeDevice=*/ false);
      expect(state.fakeHidDevice.opened).toBe(true);
    });
  });

  describe('handles input reports', () => {
    beforeEach(async () => {
      await state.dictationDevice.init();
    });

    it('does not fire for unknown input reports', async () => {
      await state.fakeHidDevice.handleInputReport([0]);
      expect(state.buttonEventListener).not.toHaveBeenCalled();
    });

    it('simple button mapping', async () => {
      const testCases: ButtonMappingTestCase[] = [
        // Single button presses
        {inputReportData: [1], expectedButtonEvents: ButtonEvent.PLAY},
        {inputReportData: [2], expectedButtonEvents: ButtonEvent.RECORD},
        // Multiple buttons at the same time
        {
          inputReportData: [3],
          expectedButtonEvents: ButtonEvent.PLAY | ButtonEvent.RECORD
        },
      ];
      const resetButtonInputReport = [0];
      await checkButtonMapping(
          state.fakeHidDevice, state.dictationDevice, state.buttonEventListener,
          testCases, resetButtonInputReport);
    });

    it('does not fire event twice if unchanged', async () => {
      // PLAY
      await state.fakeHidDevice.handleInputReport(
          [/*PLAY=*/ 1, /*unrelatedData=*/ 0, 0, 0, 0]);
      expect(state.buttonEventListener)
          .toHaveBeenCalledOnceWith(state.dictationDevice, ButtonEvent.PLAY);
      state.buttonEventListener.calls.reset();

      // Does not fire again for same buttons
      await state.fakeHidDevice.handleInputReport(
          [/*PLAY=*/ 1, /*unrelatedData=*/ 1, 2, 3, 4]);
      expect(state.buttonEventListener).not.toHaveBeenCalled();
    });
  });
});
