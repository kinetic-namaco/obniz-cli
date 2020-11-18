import chalk from "chalk";
import Defaults from "../../defaults";
import OS from "../../libs/obnizio/os";
import Device from "../obnizio/device";
import * as Storage from "../storage";
import Flash from "./_flash";
import Config from "./config";
import PreparePort from "./serial/prepare";

import inquirer from "inquirer";
import ora from "ora";

export default {
  help: `Flash obnizOS and configure it

[serial setting]
 -p --port        serial port path to flash.If not specified, the port list will be displayed.
 -b --baud        flashing baud rate. default to ${Defaults.BAUD}

[flashing setting]
 -h --hardware    hardware to be flashed. default to ${Defaults.HARDWARE}
 -v --version     obnizOS version to be flashed. default to latest one.

[obnizCloud device setting]
 -r --region      device config region
    --description device config description
 -c --config      configuration file path. If specified obniz-cli proceed settings following file like setting wifi SSID/Password.
  `,
  async execute(args: any) {
    // If device related configration exist
    // It is not allowed. because device will be created from me.
    if (args.d || args.devicekey || args.i || args.id) {
      throw new Error(`You can't pass devicekey/id arguments. Because flash-create will create new device.`);
    }

    // login check
    const token = Storage.get("token");
    if (!token) {
      throw new Error(`You must singin before create device`);
    }

    // SerialPortSetting
    const obj: any = await PreparePort(args);
    obj.stdout = (text: string) => {
      // process.stdout.write(text);
    };

    const recoveryDeviceString = Storage.get("recovery-device");
    let device;
    if (recoveryDeviceString) {
      const readedDevice = (device = JSON.parse(recoveryDeviceString));
      const use = await askUseRecovery(readedDevice);
      if (use) {
        device = readedDevice;
      } else {
        Storage.set("recovery-device", null);
      }
    }

    // No more asking

    let hardware: any;
    let version: any;
    let spinner: any;
    spinner = ora("obnizOS:").start();
    // hardware
    hardware = args.h || args.hardware || Defaults.HARDWARE;
    obj.hardware = hardware;
    // version
    version = args.v || args.version;
    if (!version) {
      spinner.text = `obnizOS: Connecting obnizCloud to Public Latest Version of hardware=${chalk.green(hardware)}`;
      version = await OS.latestPublic(hardware);
      spinner.succeed(
        `obnizOS: [using default] hardware=${chalk.green(hardware)} version=${chalk.green(
          `${version}(Public Latest Version)`,
        )}`,
      );
    } else {
      spinner.succeed(`obnizOS: decided hardware=${chalk.green(hardware)} version=${chalk.green(version)}`);
    }
    obj.version = version;

    await Flash(obj);

    if (device) {
      spinner = ora("obnizCloud:").start();
      spinner.succeed(
        `obnizCloud: using recovery device obnizID=${chalk.green(device.id)} description=${chalk.green(
          device.description,
        )} region=${chalk.green(device.region)}`,
      );
    } else {
      spinner = ora("obnizCloud: creating device on obnizCloud...").start();
      try {
        // Device Creation Setting
        const region: any = args.r || args.region || "jp";
        const description: any = args.description || "";
        // registrate
        device = await Device.create(token, {
          region,
          description,
          hardware,
        });
        Storage.set("recovery-device", JSON.stringify(device));
        spinner.succeed(
          `obnizCloud: created device on obnizCloud obnizID=${chalk.green(device.id)} description=${chalk.green(
            device.description,
          )} region=${chalk.green(device.region)}`,
        );
      } catch (e) {
        spinner.fail(`obnizCloud: ${e}`);
        throw e;
      }
    }

    try {
      // Configure it
      args.p = undefined;
      args.port = obj.portname; // 万が一この期間にシリアルポートが新たに追加されるとずれる可能性があるので
      args.devicekey = device.devicekey;
      await Config.execute(args);
      Storage.set("recovery-device", null);
    } catch (e) {
      chalk.yellow(`obnizID ${device.id} device key and information was sotred in recovery file`);
      throw e;
    }
  },
};

async function askUseRecovery(device) {
  const answer = await inquirer.prompt([
    {
      type: "list",
      name: "yesno",
      message: `Would you like to use recovery device ${device.id} [ ${device.description} ] rather than create one more device? It was failed one last time.`,
      choices: [
        {
          name: `Yes. I'm going to use recovery.`,
          value: `yes`,
        },
        {
          name: `No. Discard it and create new obnizID on obnizCloud`,
          value: `no`,
        },
      ],
      default: "yes",
    },
  ]);
  return answer.yesno === "yes";
}
