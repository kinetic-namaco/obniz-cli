"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const chalk_1 = __importDefault(require("chalk"));
const semver_1 = __importDefault(require("semver"));
const serialport_1 = __importDefault(require("serialport"));
const baudRate = 115200;
class Serial {
    constructor(obj) {
        this.totalReceived = "";
        this.portname = obj.portname;
        this.stdout = obj.stdout;
        this.onerror = obj.onerror;
        this.progress = obj.progress;
    }
    async open() {
        return new Promise(async (resolve, reject) => {
            this.serialport = new serialport_1.default(this.portname, { baudRate });
            this.serialport.on("open", () => {
                // open logic
                this.serialport.set({ rts: false, dtr: false });
                this.serialport.on("readable", async () => {
                    const received = this.serialport.read().toString("utf-8");
                    this.totalReceived += received;
                    this.stdout(received);
                    if (this._recvCallback) {
                        this._recvCallback();
                    }
                });
                resolve();
            });
            this.serialport.on("error", (err) => {
                reject(err);
                if (this.onerror) {
                    this.onerror(err);
                }
            });
        });
    }
    async close() {
        return new Promise((resolve, reject) => {
            this.serialport.close(() => {
                resolve();
            });
        });
    }
    clearReceived() {
        this.totalReceived = "";
    }
    /**
     *
     */
    async reset() {
        await new Promise(async (resolve, reject) => {
            this.serialport.set({
                dtr: false,
            }, (e) => {
                if (e) {
                    reject(e);
                    return;
                }
                resolve();
            });
        });
        await new Promise((resolve, reject) => {
            setTimeout(resolve, 10);
        });
        await new Promise(async (resolve, reject) => {
            // リセット時にはクリアする
            this.clearReceived();
            this.serialport.set({
                dtr: true,
            }, (e) => {
                if (e) {
                    reject(e);
                    return;
                }
                resolve();
            });
        });
    }
    async waitFor(key, timeout = 20 * 1000) {
        return new Promise((resolve, reject) => {
            let timeoutTimer = setTimeout(() => {
                this._recvCallback = null;
                reject(new Error(`Timeout. waiting for ${key}`));
            }, timeout);
            const check = () => {
                if (this.totalReceived.indexOf(`${key}`) >= 0) {
                    if (timeoutTimer) {
                        clearTimeout(timeoutTimer);
                        timeoutTimer = null;
                    }
                    this._recvCallback = null;
                    resolve();
                }
            };
            this._recvCallback = () => {
                check();
            };
            check();
        });
    }
    /**
     *
     */
    async waitForSettingMode() {
        return new Promise(async (resolve, reject) => {
            let timeoutTimer = setTimeout(() => {
                if (this.progress) {
                    this.progress(chalk_1.default.yellow(`Could you reset your device? Can you press reset button?`));
                }
                timeoutTimer = null;
            }, 3 * 1000);
            try {
                await this.reset();
                await this.waitFor(`Press 's' to setting mode`, 60 * 1000);
                if (timeoutTimer) {
                    clearTimeout(timeoutTimer);
                    timeoutTimer = null;
                }
                resolve();
            }
            catch (e) {
                reject(e);
            }
        });
    }
    /**
     * Sending a text
     * @param text
     */
    send(text) {
        try {
            this.serialport.write(`${text}`);
            this.totalReceived = "";
        }
        catch (e) {
            this.stdout("" + e);
        }
    }
    /**
     * Setting a Devicekey.
     * @param devicekey
     */
    async setDeviceKey(devicekey) {
        const obnizid = devicekey.split("&")[0];
        if (this.progress) {
            this.progress(`Setting Devicekey obnizID=${chalk_1.default.green(obnizid)}`);
        }
        let tryCount = 0;
        while (true) {
            if (this.totalReceived.indexOf(`obniz id: `) >= 0) {
                if (this.totalReceived.indexOf(`obniz id: ${obnizid}`) >= 0) {
                    if (this.progress) {
                        this.progress(chalk_1.default.yellow(`This device is already configured as obnizID ${obnizid}`));
                    }
                    return;
                }
                else {
                    throw new Error(`This device already configured with different device key. use 'os:erase' to flash your new devicekey`);
                }
            }
            this.send(`\n`);
            try {
                await this.waitFor("DeviceKey", 3 * 1000);
                break;
            }
            catch (e) {
                ++tryCount;
                if (tryCount <= 2) {
                    await this.reset(); // force print DeviceKey
                    await new Promise((resolve, reject) => {
                        setTimeout(resolve, 2 * 1000);
                    });
                    this.progress(chalk_1.default.yellow(`Failed Setting devicekey ${tryCount} times. Device seems not launched. Reset the connected device to wake up as Normal Mode`), { keep: true });
                }
                else if (tryCount === 3) {
                    chalk_1.default.yellow(`Failed Setting devicekey ${tryCount} times. Device seems not launched. Trying ReOpening Serial Port`),
                        await this._tryCloseOpenSerial();
                }
                else {
                    // TimedOut
                    throw new Error(`Device seems not launched. Reset the connected device to wake up as Normal Mode`);
                }
            }
        }
        this.send(`${devicekey}\n`);
        this.clearReceived();
        try {
            await this.waitFor(`obniz id: ${obnizid}`, 10 * 1000);
        }
        catch (e) {
            throw new Error(`Written obniz id not confirmed. maybe success otherwise failed.`);
        }
    }
    /**
     * Reset All Network Setting
     */
    async resetWiFiSetting() {
        if (this.progress) {
            this.progress(`Resetting All Network Setting`);
        }
        await this.waitForSettingMode();
        await this.waitFor("Input char >>", 10 * 1000);
        this.send(`s`);
        await this.waitFor("-----Select Setting-----", 10 * 1000);
        await this.waitFor("Input number >>", 10 * 1000);
        this.clearReceived();
        this.send(`3`); // Reset All
        await this.waitFor("-----Wireless LAN Reset-----", 10 * 1000);
        await this.waitFor("Input char >>", 10 * 1000);
        this.send(`y`); // yes to reset
        this.clearReceived();
        await this.waitFor("Rebooting", 10 * 1000);
    }
    /**
     * Reset All Network Setting
     */
    async resetAllSetting() {
        if (this.progress) {
            this.progress(`Resetting All Network Setting`);
        }
        await this.waitForSettingMode();
        await this.waitFor("Input char >>", 10 * 1000);
        this.send(`s`);
        await this.waitFor("-----Select Setting-----", 10 * 1000);
        await this.waitFor("Input number >>", 10 * 1000);
        this.clearReceived();
        this.send(`2`); // Reset All
        await this.waitFor("-----All Reset", 10 * 1000);
        await this.waitFor("Input char >>", 10 * 1000);
        this.send(`y`); // yes to reset
        this.clearReceived();
        await this.waitFor("Rebooting", 10 * 1000);
    }
    /**
     * Setting Network Type.
     * @param type
     */
    async setNetworkType(type) {
        if (this.progress) {
            this.progress(`Setting Network Type`);
        }
        await this.waitForSettingMode();
        await this.waitFor("Input char >>", 10 * 1000);
        this.send(`s`);
        await this.waitFor("-----Select Setting-----", 10 * 1000);
        await this.waitFor("Input number >>", 10 * 1000);
        this.clearReceived();
        this.send(`1`); // Interface
        const interfaces = ["wifi", "ethernet", "cellular"];
        const index = interfaces.indexOf(type);
        if (index < 0) {
            throw new Error(`unknown interface type ${type}`);
        }
        this.send(`${index}`);
    }
    /**
     * Setting WiFi
     * @param obj
     */
    async setWiFi(setting) {
        if (this.progress) {
            this.progress(`Setting Wi-Fi`);
        }
        // check obnizOS ver
        await this.waitFor("obniz ver:", 10 * 1000);
        const verLine = this._searchLine("obniz ver:");
        let version = "0.0.0";
        if (!verLine) {
            if (this.progress) {
                this.progress(chalk_1.default.yellow("Failed to check obnizOS version. Subsequent flows can be failed."));
            }
        }
        else {
            version = semver_1.default.clean(verLine.split("obniz ver: ")[1]);
        }
        if (semver_1.default.satisfies(version, ">=3.4.2")) {
            // Interface
            await this.waitFor("-----Select Interface-----", 30 * 1000);
            await this.waitFor("Input number >>", 10 * 1000);
            this.send(`0`);
            this.clearReceived();
        }
        // SSID
        await this.waitFor("--- Select SSID Number ---", 30 * 1000);
        await this.waitFor("Input number >>", 10 * 1000);
        const line = this._searchLine("-- Other Network --");
        if (!line) {
            throw new Error(`Not Supported OS`);
        }
        let leftside = line.split(":")[0];
        leftside = leftside.replace("-", "");
        const indexNumber = parseInt(leftside);
        if (isNaN(indexNumber)) {
            throw new Error(`Failed to parse serial console. LINE="${line}"`);
        }
        this.send(`${indexNumber}\n`);
        this.clearReceived();
        if (semver_1.default.satisfies(version, "<3.4.2")) {
            // Hidden
            await this.waitFor("--- Hidden SSID ---", 10 * 1000);
            await this.waitFor("Input number >>", 10 * 1000);
            if (setting.hidden) {
                this.send(`1`);
            }
            else {
                this.send(`0`);
            }
            this.clearReceived();
        }
        await this.waitFor("--- SSID ---", 10 * 1000);
        await this.waitFor("Input text >>", 10 * 1000);
        this.send(`${setting.ssid}\n`);
        this.clearReceived();
        // Password
        await this.waitFor("--- Password ---", 10 * 1000);
        await this.waitFor("Input text >>", 10 * 1000);
        this.send(`${setting.password}\n`);
        this.clearReceived();
        // DHCP
        await this.waitFor("--- select Network ---", 10 * 1000);
        await this.waitFor("Input number >>", 10 * 1000);
        if (setting.dhcp === false) {
            this.send(`1`);
            this.clearReceived();
            await this.waitFor("--- IP Address ---", 10 * 1000);
            await this.waitFor("Input address >>", 10 * 1000);
            this.send(`${setting.static_ip}\n`);
            this.clearReceived();
            await this.waitFor("--- Default Gateway ---", 10 * 1000);
            await this.waitFor("Input address >>", 10 * 1000);
            this.send(`${setting.default_gateway}\n`);
            this.clearReceived();
            await this.waitFor("--- Subnet Mask ---", 10 * 1000);
            await this.waitFor("Input address >>", 10 * 1000);
            this.send(`${setting.subnetmask}\n`);
            this.clearReceived();
            await this.waitFor("--- DNS Address ---", 10 * 1000);
            await this.waitFor("Input address >>", 10 * 1000);
            this.send(`${setting.dns}\n`);
            this.clearReceived();
        }
        else {
            this.send(`0`);
            this.clearReceived();
        }
        // PROXY
        await this.waitFor("--- Proxy Setting ---", 10 * 1000);
        await this.waitFor("Input number >>", 10 * 1000);
        if (setting.proxy) {
            this.send(`1`);
            this.clearReceived();
            await this.waitFor("--- Proxy Config ---", 10 * 1000);
            await this.waitFor("Input text >>", 10 * 1000);
            this.send(`${setting.proxy_address}\n`);
            this.clearReceived();
            await this.waitFor("--- Proxy Port ---", 10 * 1000);
            await this.waitFor("Input number >>", 10 * 1000);
            this.send(`${setting.proxy_port}\n`);
            this.clearReceived();
        }
        else {
            this.send(`0`);
            this.clearReceived();
        }
        await this.waitFor("Wi-Fi Connecting SSID", 10 * 1000);
        if (this.progress) {
            this.progress(chalk_1.default.green("Suceeded"));
        }
    }
    async _tryCloseOpenSerial() {
        await this.close();
        await this.open();
    }
    _searchLine(text) {
        for (const line of this.totalReceived.split("\n")) {
            if (line.indexOf(text) >= 0) {
                return line;
            }
        }
        return null;
    }
}
exports.default = Serial;
