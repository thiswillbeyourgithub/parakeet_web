#  Dictation support SDK

##  Features
The SDK provided with this repository allows web-based apps/pages to interact with dictation devices:
* Events for connected / disconnected devices
* Events for button presses / slider movements
* Events for motion events (pickedup and layed down)
* Commands to set LED states (predefined states or individual LED settings)

### Demo website
You can test out the SDK capabilities with a supported device using this [demo website](https://storage.googleapis.com/chromeos-mgmt-public-extension/dictation_support/index.html).

TODO: host latest release and link here

###  Supported devices
| Dictation microphones                    | Foot controls   |
|:-----------------------------------------|:----------------|
| Philips SpeechMike Premium LFH3500       | Philips ACC2310 |
| Philips SpeechMike Premium LFH3510       | Philips ACC2320 |
| Philips SpeechMike Premium LFH3520       | Philips ACC2330 |
| Philips SpeechMike Premium LFH3600       |                 |
| Philips SpeechMike Premium LFH3610       |                 |
| Philips SpeechMike Premium Touch SMP3700 |                 |
| Philips SpeechMike Premium Touch SMP3710 |                 |
| Philips SpeechMike Premium Touch SMP3720 |                 |
| Philips SpeechMike Premium Touch SMP3800 |                 |
| Philips SpeechMike Premium Touch SMP3810 |                 |
| Philips SpeechMike Premium Air SMP4000   |                 |
| Philips SpeechMike Premium Air SMP4010   |                 |
| Philips SpeechOne PSM6000                |                 |
| Philips SpeechMike Ambient PSM5000       |                 |
| Nuance PowerMic III                      |                 |
| Nuance PowerMic 4                        |                 |

###  Supported platforms
* Google Chrome on Windows, macOS, Linux and Chrome OS (Chromebooks)
* Microsoft Edge on Windows and macOS

#### Note
If your browser runs remotely (e.g. Citrix Virtual Apps and Desktops, VMware Horizon...) you need to have the dictation device buttons redirected on USB level. Please follow documentation provided by the virtualization platform vendors.

##  How to use

###  Sample usage

#### NPM package
[Link to package](https://www.npmjs.com/package/dictation_support)

Run `npm install dictation_support --save-dev` to install the package as dependency and then use as

```typescript
import { DictationDevice, ButtonEvent, DictationDeviceManager } from 'dictation_support';

const manager = new DictationDeviceManager();
// Your code here
```

#### Include compiled sdk
To use the SDK, simply include the compiled `index.js` into your web page/app and create an instance of `DictationSupport.DictationDeviceManager`. See [/example/index.ejs](https://github.com/GoogleChromeLabs/dictation_support/blob/main/example/index.ejs) or the resulting `/dist/index.html` for an example.

###  WebHID permission / policy
The SDK requires permission to interact with the device using the [WebHID API](https://wicg.github.io/webhid/). This can happen two different ways:

#### User grants permission
You can use `await deviceManager.requestDevice()`, which will prompt the user to select one of the supported devices from a pop-up. Once the user has granted permission, the device will be available, i.e. a new `DictationDevice` will be created. That device will also be available via `deviceManger.getDevices()` when the page reloads. Disconnecting and reconnecting the device will require the user to grant permission again using `deviceManager.requestDevice()`.

#### Admin grants permission
TODO(Google): surface [WebHidAllowAllDevicesForUrls](https://chromeenterprise.google/policies/#WebHidAllowAllDevicesForUrls) to the admin console (ETA: 2022Q4)

Instead of the user being prompted to grant permissions, the admin can also grant permissions upfront.

On the [Google admin console](https://admin.google.com), navigate to the user or managed guest session policy page and search for `WebHidAllowAllDevicesForUrls`. With this setting, you can allowlist certain devices (vendor ID & product ID)  to the URLs you want to use the SDK on.
Note: The Philips SpeechMikes have different product IDs depending on the event mode (HID vs browser/gamepad mode), see [/src/device_manager.ts](https://github.com/GoogleChromeLabs/dictation_support/blob/main/src/dictation_device_manager.ts) for a list of supported product and vendor IDs (in hex format) in various modes. The product and vendor ID for the policy have to be provided in decimal representation.

If the device is granted permission via policy, the device will be available to the SDK immediately when it is connected (also firing an event).

##  Developer instructions

##  Installation
In order to get started developing, run `npm install` to install the required dependencies.

##  Build
To build the SDK, run `npm run build`, which will create the following set of files
* `/dist/index.js` the SDK you need to include
* `/dist/index.d.ts` Typescript typings for the SDK
* `/dist/index.html` sample page using the SDK

## Contributing
Feel free to send pull-requests! All code changes must be:
* approved by a project maintainer
* pass linting (use `npm run lint`)
* be properly formatted (use `npm run format` or `npm run formatCheck`)
* pass tests (use `npm test`)
