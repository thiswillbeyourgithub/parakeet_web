import {DictationDevice} from './dictation_device';
import {ImplementationType} from './dictation_device_base';
import {DictationDeviceManager} from './dictation_device_manager';
import {FootControlDevice} from './foot_control_device';
import {PowerMic3Device} from './powermic_3_device';
import {SpeechMikeGamepadDevice} from './speechmike_gamepad_device';
import {SpeechMikeHidDevice} from './speechmike_hid_device';
import {cleanState} from './test_util/clean_state';
import {FakeHidApi} from './test_util/fake_hid_api';
import {FakeHidDevice} from './test_util/fake_hid_device';

type DeviceCreationTestCase = {
  name: string,
  hidDevices: FakeHidDevice[],
  expectedPowerMic3HidDeviceIndex?: number,
  expectedFootControlHidDeviceIndex?: number,
  expectedSpeechMikeHidHidDeviceIndex?: number,
  expectedSpeechMikeGamepadHidDeviceIndex?: number
};

const SAMPLE_HID_DEVICES: FakeHidDevice[] = [
  // PowerMic3
  new FakeHidDevice({
    vendorId: 0x0554,
    productId: 0x1001,
    collections: [{usagePage: 1, usage: 0}]
  }),
  // FootControl AC2330
  new FakeHidDevice({
    vendorId: 0x0911,
    productId: 0x091a,
    collections: [{usagePage: 1, usage: 4}]
  }),
];

describe('DictationDeviceManager', () => {
  const state = cleanState<{
    buttonEventListener: jasmine.Spy,
    deviceManager: DictationDeviceManager,
    fakeHidApi: FakeHidApi,
    footControlDevice: jasmine.SpyObj<FootControlDevice>,
    footControlCreateSpy: jasmine.Spy,
    motionEventListener: jasmine.Spy,
    powerMic3Device: jasmine.SpyObj<PowerMic3Device>,
    powerMic3CreateSpy: jasmine.Spy,
    speechMikeHidDevice: jasmine.SpyObj<SpeechMikeHidDevice>,
    speechMikeHidCreateSpy: jasmine.Spy,
    speechMikeGamepadDevice: jasmine.SpyObj<SpeechMikeGamepadDevice>,
    speechMikeGamepadCreateSpy: jasmine.Spy,
  }>();

  beforeEach(() => {
    state.fakeHidApi = new FakeHidApi();

    state.buttonEventListener = jasmine.createSpy('buttonEventListener');
    state.motionEventListener = jasmine.createSpy('motionEventListener');

    state.footControlCreateSpy = spyOn(FootControlDevice, 'create');
    state.footControlCreateSpy.and.callFake((hidDevice: HIDDevice) => {
      state.footControlDevice = jasmine.createSpyObj<FootControlDevice>(
          'footControlDevice',
          [
            'addButtonEventListener',
            'init',
            'shutdown',
          ],
          {
            hidDevice,
            implType: ImplementationType.FOOT_CONTROL,
          });
      return state.footControlDevice;
    });

    state.powerMic3CreateSpy = spyOn(PowerMic3Device, 'create');
    state.powerMic3CreateSpy.and.callFake((hidDevice: HIDDevice) => {
      state.powerMic3Device = jasmine.createSpyObj<PowerMic3Device>(
          'powerMic3Device',
          [
            'addButtonEventListener',
            'init',
            'shutdown',
          ],
          {
            hidDevice,
            implType: ImplementationType.POWERMIC_3,
          });
      return state.powerMic3Device;
    });

    state.speechMikeHidCreateSpy = spyOn(SpeechMikeHidDevice, 'create');
    state.speechMikeHidCreateSpy.and.callFake((hidDevice: HIDDevice) => {
      state.speechMikeHidDevice = jasmine.createSpyObj<SpeechMikeHidDevice>(
          'speechMikeHidDevice',
          [
            'addButtonEventListener',
            'addMotionEventListener',
            'init',
            'assignProxyDevice',
            'shutdown',
          ],
          {
            hidDevice,
            implType: ImplementationType.SPEECHMIKE_HID,
          });
      return state.speechMikeHidDevice;
    });

    state.speechMikeGamepadCreateSpy = spyOn(SpeechMikeGamepadDevice, 'create');
    state.speechMikeGamepadCreateSpy.and.callFake((hidDevice: HIDDevice) => {
      state.speechMikeGamepadDevice =
          jasmine.createSpyObj<SpeechMikeGamepadDevice>(
              'speechMikeGamepadDevice',
              [
                'addButtonEventListener',
                'init',
                'shutdown',
              ],
              {
                hidDevice,
                implType: ImplementationType.SPEECHMIKE_GAMEPAD,
              });
      return state.speechMikeGamepadDevice;
    });

    state.deviceManager = new DictationDeviceManager(state.fakeHidApi);
    state.deviceManager.addButtonEventListener(state.buttonEventListener);
    state.deviceManager.addMotionEventListener(state.motionEventListener);
  });

  async function connectHidDevices(
      hidDevices: FakeHidDevice[], isPending = false) {
    for (const hidDevice of hidDevices) {
      await state.fakeHidApi.connectDevice(hidDevice, isPending);
    }
  }

  function checkDeviceCreation(
      devices: DictationDevice[], testCase: DeviceCreationTestCase) {
    const expectedDevices: jasmine.SpyObj<DictationDevice>[] = [];

    if (testCase.expectedPowerMic3HidDeviceIndex !== undefined) {
      const expectedPowerMic3HidDevice =
          testCase.hidDevices[testCase.expectedPowerMic3HidDeviceIndex];
      expect(PowerMic3Device.create)
          .toHaveBeenCalledOnceWith(expectedPowerMic3HidDevice);
      expectedDevices.push(state.powerMic3Device);
    }
    if (testCase.expectedFootControlHidDeviceIndex !== undefined) {
      const expectedFootControlHidDevice =
          testCase.hidDevices[testCase.expectedFootControlHidDeviceIndex];
      expect(FootControlDevice.create)
          .toHaveBeenCalledOnceWith(expectedFootControlHidDevice);
      expectedDevices.push(state.footControlDevice);
    }
    if (testCase.expectedSpeechMikeHidHidDeviceIndex !== undefined) {
      const expectedSpeechMikeHidHidDevice =
          testCase.hidDevices[testCase.expectedSpeechMikeHidHidDeviceIndex];
      expect(SpeechMikeHidDevice.create)
          .toHaveBeenCalledOnceWith(expectedSpeechMikeHidHidDevice);
      expectedDevices.push(state.speechMikeHidDevice);
    }
    if (testCase.expectedSpeechMikeGamepadHidDeviceIndex !== undefined) {
      const expectedSpeechMikeGamepadHidDevice =
          testCase.hidDevices[testCase.expectedSpeechMikeGamepadHidDeviceIndex];
      expect(SpeechMikeGamepadDevice.create)
          .toHaveBeenCalledOnceWith(expectedSpeechMikeGamepadHidDevice);
      expect(state.speechMikeHidDevice.assignProxyDevice)
          .toHaveBeenCalledOnceWith(state.speechMikeGamepadDevice);
      // Not adding to `expectedDevices` here since
      // SpeechMikeGamePadDicationDevices only show up as proxy within
      // SpeechMikeHidDictationDevices.
    }

    expect(devices).toEqual(expectedDevices);

    for (const device of expectedDevices) {
      expect(device.init).toHaveBeenCalled();
      expect(device.addButtonEventListener)
          .toHaveBeenCalledOnceWith(state.buttonEventListener);
      if (device.implType === ImplementationType.SPEECHMIKE_HID) {
        expect(state.speechMikeHidDevice.addMotionEventListener)
            .toHaveBeenCalledOnceWith(state.motionEventListener);
      }
    }
  }

  describe('creates the right device', () => {
    const testCases: DeviceCreationTestCase[] = [
      {
        name: 'PowerMic3',
        hidDevices: [
          new FakeHidDevice({
            vendorId: 0x0554,
            productId: 0x1001,
            collections: [{usagePage: 1, usage: 0}]
          }),
        ],
        expectedPowerMic3HidDeviceIndex: 0,
      },
      {
        name: 'FootControl ACC2310/2320',
        hidDevices: [
          new FakeHidDevice({
            vendorId: 0x0911,
            productId: 0x1844,
            collections: [{usagePage: 1, usage: 4}]
          }),
        ],
        expectedFootControlHidDeviceIndex: 0,
      },
      {
        name: 'FootControl ACC2330',
        hidDevices: [
          new FakeHidDevice({
            vendorId: 0x0911,
            productId: 0x091a,
            collections: [{usagePage: 1, usage: 4}]
          }),
        ],
        expectedFootControlHidDeviceIndex: 0,
      },
      {
        name: 'PowerMic4 (in either mode)',
        hidDevices: [
          new FakeHidDevice({
            vendorId: 0x0554,
            productId: 0x0064,
            collections: [{usagePage: 65440, usage: 1}]
          }),
          new FakeHidDevice({
            vendorId: 0x0554,
            productId: 0x0064,
            collections: [{usagePage: 1, usage: 4}]
          })
        ],
        expectedSpeechMikeHidHidDeviceIndex: 0,
        expectedSpeechMikeGamepadHidDeviceIndex: 1,
      },
      {
        name: 'SpeechOne PSM6000 (in either mode)',
        hidDevices: [
          new FakeHidDevice({
            vendorId: 0x0911,
            productId: 0x0c1e,
            collections: [{usagePage: 65440, usage: 1}]
          }),
          new FakeHidDevice({
            vendorId: 0x0911,
            productId: 0x0c1e,
            collections: [{usagePage: 1, usage: 4}]
          })
        ],
        expectedSpeechMikeHidHidDeviceIndex: 0,
        expectedSpeechMikeGamepadHidDeviceIndex: 1,
      },
      {
        name: 'SpeechMike 3xxx (in HID mode)',
        hidDevices: [
          new FakeHidDevice({
            vendorId: 0x0911,
            productId: 0x0c1c,
            collections: [{usagePage: 65440, usage: 1}]
          }),
        ],
        expectedSpeechMikeHidHidDeviceIndex: 0,
      },
      {
        name: 'SpeechMike 40xx (in HID mode)',
        hidDevices: [
          new FakeHidDevice({
            vendorId: 0x0911,
            productId: 0x0c1d,
            collections: [{usagePage: 65440, usage: 1}]
          }),
        ],
        expectedSpeechMikeHidHidDeviceIndex: 0,
      },
      {
        name: 'SpeechMike 3xxx/40xx (in Gamepad mode)',
        hidDevices: [
          new FakeHidDevice({
            vendorId: 0x0911,
            productId: 0x0fa0,
            collections: [{usagePage: 65440, usage: 1}]
          }),
          new FakeHidDevice({
            vendorId: 0x0911,
            productId: 0x0fa0,
            collections: [{usagePage: 1, usage: 4}]
          })
        ],
        expectedSpeechMikeHidHidDeviceIndex: 0,
        expectedSpeechMikeGamepadHidDeviceIndex: 1,
      }
    ];

    for (const testCase of testCases) {
      describe(testCase.name, () => {
        it('when already connected during init()', async () => {
          await connectHidDevices(testCase.hidDevices);
          await state.deviceManager.init();

          const devices = state.deviceManager.getDevices();
          checkDeviceCreation(devices, testCase);
        });

        it('when already connected and requested via requestDevice()',
           async () => {
             await connectHidDevices(testCase.hidDevices, /*isPending=*/ true);
             await state.deviceManager.init();

             const devicesAfterInit = state.deviceManager.getDevices();
             expect(devicesAfterInit).toEqual([]);

             const devicesAfterRequest =
                 await state.deviceManager.requestDevice();
             checkDeviceCreation(devicesAfterRequest, testCase);
           });

        it('when newly connected', async () => {
          await state.deviceManager.init();

          await connectHidDevices(testCase.hidDevices);

          const devices = state.deviceManager.getDevices();
          checkDeviceCreation(devices, testCase);
        });
      });
    }

    it('sets the right filters for requestDevice()', async () => {
      spyOn(state.fakeHidApi, 'requestDevice').and.callThrough();

      await state.deviceManager.init();
      await state.deviceManager.requestDevice();

      expect(state.fakeHidApi.requestDevice).toHaveBeenCalledOnceWith({
        filters: [
          {vendorId: 2321, productId: 3100, usagePage: 65440, usage: 1},
          {vendorId: 2321, productId: 3101, usagePage: 65440, usage: 1},
          {vendorId: 2321, productId: 3102, usagePage: 65440, usage: 1},
          {vendorId: 2321, productId: 4000, usagePage: 65440, usage: 1},
          {vendorId: 1364, productId: 100, usagePage: 65440, usage: 1},
          {vendorId: 2321, productId: 4000, usagePage: 1, usage: 4},
          {vendorId: 2321, productId: 3102, usagePage: 1, usage: 4},
          {vendorId: 1364, productId: 100, usagePage: 1, usage: 4},
          {vendorId: 2321, productId: 6212, usagePage: 1, usage: 4},
          {vendorId: 2321, productId: 2330, usagePage: 1, usage: 4},
          {vendorId: 1364, productId: 4097, usagePage: 1, usage: 0}
        ]
      });
    });

    it('ignores irrelevant HIDDevices', async () => {
      const hidDevices: FakeHidDevice[] = [
        // Unknown vendor / product ID
        new FakeHidDevice({vendorId: 123, productId: 456}),
        // Known vendor / product, but wrong usagePage or usage
        new FakeHidDevice({
          vendorId: 0x0911,
          productId: 0x0c1c,
        }),
        new FakeHidDevice({
          vendorId: 0x0911,
          productId: 0x0c1c,
          collections: [{usagePage: 123, usage: 456}]
        }),
      ];
      await connectHidDevices(hidDevices);

      await state.deviceManager.init();
      const devices = state.deviceManager.getDevices();
      expect(devices).toEqual([]);
    });
  });

  describe('with connected devices', () => {
    beforeEach(async () => {
      await connectHidDevices(SAMPLE_HID_DEVICES);

      await state.deviceManager.init();
      const devices = state.deviceManager.getDevices();
      expect(devices).toEqual([state.powerMic3Device, state.footControlDevice]);

      expect(state.powerMic3Device.shutdown).not.toHaveBeenCalled();
      expect(state.footControlDevice.shutdown).not.toHaveBeenCalled();
    });

    it('handles disconnect', async () => {
      // Disconnect PowerMic3
      await state.fakeHidApi.disconnectDevice(SAMPLE_HID_DEVICES[0]);
      expect(state.powerMic3Device.shutdown)
          .toHaveBeenCalledOnceWith(/*closeDevice=*/ false);
      expect(state.footControlDevice.shutdown).not.toHaveBeenCalled();
      state.powerMic3Device.shutdown.calls.reset();

      // Disconnect PowerMic3
      await state.fakeHidApi.disconnectDevice(SAMPLE_HID_DEVICES[1]);
      expect(state.powerMic3Device.shutdown).not.toHaveBeenCalled();
      expect(state.footControlDevice.shutdown)
          .toHaveBeenCalledOnceWith(/*closeDevice=*/ false);
    });

    it('handles shut down', async () => {
      await state.deviceManager.shutdown();

      // Shuts down and closes devices
      expect(state.powerMic3Device.shutdown)
          .toHaveBeenCalledOnceWith(/*closeDevice=*/ true);
      expect(state.footControlDevice.shutdown)
          .toHaveBeenCalledOnceWith(/*closeDevice=*/ true);

      // Does not react to new connections
      state.powerMic3CreateSpy.calls.reset();
      state.footControlCreateSpy.calls.reset();
      await connectHidDevices(SAMPLE_HID_DEVICES);
      expect(state.powerMic3CreateSpy).not.toHaveBeenCalled();
      expect(state.footControlCreateSpy).not.toHaveBeenCalled();
    });
  });

  it('handles devices failing to initialize', async () => {
    state.powerMic3CreateSpy.and.callFake((hidDevice: HIDDevice) => {
      state.powerMic3Device = jasmine.createSpyObj<PowerMic3Device>(
          'powerMic3Device',
          [
            'addButtonEventListener',
            'init',
            'shutdown',
          ],
          {
            hidDevice,
            implType: ImplementationType.POWERMIC_3,
          });
      state.powerMic3Device.init.and.rejectWith('fail');
      return state.powerMic3Device;
    });

    await connectHidDevices(SAMPLE_HID_DEVICES);

    await state.deviceManager.init();
    const devices = state.deviceManager.getDevices();
    expect(devices).toEqual([state.footControlDevice]);
  });
});
