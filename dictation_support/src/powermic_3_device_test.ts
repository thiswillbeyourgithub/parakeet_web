import {ButtonEvent, DeviceType, ImplementationType} from './dictation_device_base';
import {LedStatePM3, PowerMic3Device} from './powermic_3_device';
import {ButtonMappingTestCase, checkButtonMapping} from './test_util/check_button_mapping';
import {cleanState} from './test_util/clean_state';
import {FakeHidDevice} from './test_util/fake_hid_device';

describe('PowerMic3Device', () => {
  const state = cleanState<{
    buttonEventListener: jasmine.Spy,
    dictationDevice: PowerMic3Device,
    fakeHidDevice: FakeHidDevice,
    sendReportReceiver: jasmine.Spy,
  }>();

  beforeEach(async () => {
    state.buttonEventListener = jasmine.createSpy('buttonEventListener');
    state.sendReportReceiver = jasmine.createSpy('sendReportReceiver');

    state.fakeHidDevice = new FakeHidDevice({
      productId: 0x1001,
      vendorId: 0x0554,
      sendReportReceiver: state.sendReportReceiver
    });
    state.dictationDevice = PowerMic3Device.create(state.fakeHidDevice);
    state.dictationDevice.addButtonEventListener(state.buttonEventListener);
    await state.dictationDevice.init();
  });

  it('creates the right device type', async () => {
    expect(state.dictationDevice.getDeviceType()).toBe(DeviceType.POWERMIC_3);
    expect(state.dictationDevice.implType).toBe(ImplementationType.POWERMIC_3);
  });

  it('handles input reports', async () => {
    const testCases: ButtonMappingTestCase[] = [
      {
        inputReportData: [0, 0, 0],
        expectedButtonEvents: undefined,
      },
      {
        inputReportData: [0, 1, 0],
        expectedButtonEvents: ButtonEvent.TRANSCRIBE
      },
      {
        inputReportData: [0, 2, 0],
        expectedButtonEvents: ButtonEvent.TAB_BACKWARD
      },
      {
        inputReportData: [0, 4, 0],
        expectedButtonEvents: ButtonEvent.RECORD,
      },
      {
        inputReportData: [0, 8, 0],
        expectedButtonEvents: ButtonEvent.TAB_FORWARD
      },
      {
        inputReportData: [0, 16, 0],
        expectedButtonEvents: ButtonEvent.REWIND,
      },
      {
        inputReportData: [0, 32, 0],
        expectedButtonEvents: ButtonEvent.FORWARD,
      },
      {
        inputReportData: [0, 64, 0],
        expectedButtonEvents: ButtonEvent.PLAY,
      },
      {
        inputReportData: [0, 128, 0],
        expectedButtonEvents: ButtonEvent.CUSTOM_LEFT
      },
      {
        inputReportData: [0, 0, 1],
        expectedButtonEvents: ButtonEvent.ENTER_SELECT
      },
      {
        inputReportData: [0, 0, 2],
        expectedButtonEvents: ButtonEvent.CUSTOM_RIGHT
      },
      {
        inputReportData: [0, 0, 4],
        expectedButtonEvents: undefined,
      },
    ];
    const resetButtonInputReport = [0, 0, 0];
    await checkButtonMapping(
        state.fakeHidDevice, state.dictationDevice, state.buttonEventListener,
        testCases, resetButtonInputReport);
  });

  it('sends commands to set LEDs', async () => {
    expect(state.sendReportReceiver).not.toHaveBeenCalled();

    // OFF
    await state.dictationDevice.setLed(LedStatePM3.OFF);
    expect(state.sendReportReceiver)
        .toHaveBeenCalledOnceWith(/* reportId= */ 0, new Uint8Array([0]));
    state.sendReportReceiver.calls.reset();

    // RED
    await state.dictationDevice.setLed(LedStatePM3.RED);
    expect(state.sendReportReceiver)
        .toHaveBeenCalledOnceWith(/* reportId= */ 0, new Uint8Array([1]));
    state.sendReportReceiver.calls.reset();

    // GREEN
    await state.dictationDevice.setLed(LedStatePM3.GREEN);
    expect(state.sendReportReceiver)
        .toHaveBeenCalledOnceWith(/* reportId= */ 0, new Uint8Array([2]));
    state.sendReportReceiver.calls.reset();
  });
});
