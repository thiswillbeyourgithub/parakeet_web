import {ButtonEvent, DictationDeviceBase} from '../dictation_device_base';

import {FakeHidDevice} from './fake_hid_device';

export type ButtonMappingTestCase = {
  inputReportData: number[],
  expectedButtonEvents: ButtonEvent|undefined,
}

/*
   Runs through all `testCases` and emulates the respective `inputReportData`
   being sent, followed by the `resetInputReport` being sent. If
   `expectedButtonEvents` (can be a combination of ButtonEvents) has a value, it
   expects the `buttonEventListener` to be called with `expectedDevice` and
   `expectedButtonEvents` when the test cases's input report is being sent and
   then a ButtonEvent.NONE when the `resetInputCommand` (=emulating releasing
   the button) is being sent. If `expectedButtonEvents` is undefined, no button
   event should be emitted for the test case's `inputReportData` or the
   `resetInputReport`.
 */
export async function checkButtonMapping(
    fakeHidDevice: FakeHidDevice, expectedDicationDevice: DictationDeviceBase,
    buttonEventListener: jasmine.Spy, testCases: ButtonMappingTestCase[],
    resetInputReport: number[]|undefined) {
  for (let i = 0; i < testCases.length; ++i) {
    const testCase = testCases[i];
    // Press button(s)
    buttonEventListener.calls.reset();
    await fakeHidDevice.handleInputReport(testCase.inputReportData);
    const contextMessageButtonPress =
        `for test case ${i} (inputReport [${testCase.inputReportData})]`
    if (testCase.expectedButtonEvents !== undefined) {
      expect(buttonEventListener)
          .withContext(contextMessageButtonPress)
          .toHaveBeenCalledOnceWith(
              expectedDicationDevice, testCase.expectedButtonEvents);
    }
    else {
      expect(buttonEventListener)
          .withContext(contextMessageButtonPress)
          .not.toHaveBeenCalled();
    }

    if (resetInputReport === undefined) continue;

    // Release button(s)
    buttonEventListener.calls.reset();
    await fakeHidDevice.handleInputReport(resetInputReport);
    const contextMessageButtonRelease = `for test case ${i} (inputReport [${
        resetInputReport} after ${testCase.inputReportData})]`
    if (testCase.expectedButtonEvents !== undefined) {
      expect(buttonEventListener)
          .withContext(contextMessageButtonRelease)
          .toHaveBeenCalledOnceWith(expectedDicationDevice, ButtonEvent.NONE);
    }
    else {
      expect(buttonEventListener)
          .withContext(contextMessageButtonRelease)
          .not.toHaveBeenCalled();
    }
  }
}
