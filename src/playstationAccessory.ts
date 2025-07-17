import {
  API,
  Characteristic,
  CharacteristicValue,
  PlatformAccessory,
  Service,
} from 'homebridge';
import path from 'path';

import { Device } from 'playactor/dist/device';
import { DeviceStatus, IDiscoveredDevice } from 'playactor/dist/discovery/model';

import { PlaystationPlatform } from './playstationPlatform';
import { PLUGIN_NAME } from './settings';
import { spawn } from 'child_process';

function timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout')), ms);
    promise.then((val) => {
      clearTimeout(timer);
      resolve(val);
    }).catch((err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export class PlaystationAccessory {
  private readonly accessory: PlatformAccessory;
  private readonly tvService: Service;
  private readonly api: API = this.platform.api;
  private readonly Service: typeof Service = this.platform.Service;
  private readonly Characteristic: typeof Characteristic = this.platform.Characteristic;

  private lockUpdate = false;
  private lockSetOn = false;
  private tick: NodeJS.Timeout | undefined;
  private lockTimeout: NodeJS.Timeout | undefined;
  private readonly kLockTimeout = 20_000;

  private titleIDs: string[] = [];
  private dynamicTitleSource: Service | null = null;
  private titleUpdateInterval: NodeJS.Timeout | null = null;
  private lastTitle: string | null = null;

  constructor(
    private readonly platform: PlaystationPlatform,
    private deviceInformation: IDiscoveredDevice,
  ) {
    const uuid = this.api.hap.uuid.generate(deviceInformation.id);
    const deviceName = deviceInformation.name;

    this.accessory = new this.api.platformAccessory(deviceName, uuid);
    this.accessory.category = this.api.hap.Categories.TV_SET_TOP_BOX;

    this.accessory.getService(this.Service.AccessoryInformation)!
      .setCharacteristic(this.Characteristic.Manufacturer, 'Sony')
      .setCharacteristic(this.Characteristic.Model, deviceInformation.type)
      .setCharacteristic(this.Characteristic.SerialNumber, deviceInformation.id)
      .setCharacteristic(this.Characteristic.FirmwareRevision, deviceInformation.systemVersion);

    this.tvService =
      this.accessory.getService(this.Service.Television) ||
      this.accessory.addService(this.Service.Television);

    this.tvService
      .setCharacteristic(this.Characteristic.ConfiguredName, deviceName)
      .setCharacteristic(
        this.Characteristic.SleepDiscoveryMode,
        this.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE,
      );

    this.tvService.getCharacteristic(this.Characteristic.Active)
      .onSet(this.setOn.bind(this))
      .onGet(this.getOn.bind(this));

    this.tvService.getCharacteristic(this.Characteristic.RemoteKey)
      .onSet((newValue: CharacteristicValue) => {
        this.platform.log.debug(`[${this.deviceInformation.id}] RemoteKey not implemented`, newValue);
      });

    this.tvService.setCharacteristic(this.Characteristic.ActiveIdentifier, 0);

    this.addTitle('PSAXXXX', 'Loading...', 0);
    this.startTitleUpdateLoop();

    this.tvService.getCharacteristic(this.Characteristic.ActiveIdentifier)
      .onSet(this.setTitleSwitchState.bind(this));

    this.tick = setInterval(
      this.updateDeviceInformations.bind(this),
      this.platform.config.pollInterval || 120000,
    );

    this.api.publishExternalAccessories(PLUGIN_NAME, [this.accessory]);
  }


  private addTitle(titleId: string, titleName: string, index: number) {
    const titleInputSource = new this.Service.InputSource(titleName, titleId);
    titleInputSource
      .setCharacteristic(this.Characteristic.Identifier, index)
      .setCharacteristic(this.Characteristic.Name, titleName)
      .setCharacteristic(this.Characteristic.ConfiguredName, titleName)
      .setCharacteristic(this.Characteristic.IsConfigured, this.Characteristic.IsConfigured.NOT_CONFIGURED)
      .setCharacteristic(this.Characteristic.InputSourceType, this.Characteristic.InputSourceType.APPLICATION)
      .setCharacteristic(this.Characteristic.CurrentVisibilityState, this.Characteristic.CurrentVisibilityState.HIDDEN);

    this.accessory.addService(titleInputSource);
    this.tvService.addLinkedService(titleInputSource);
    this.titleIDs.push(titleId);
    this.dynamicTitleSource = titleInputSource;
  }

  private startTitleUpdateLoop() {
    const PSNAWP = this.platform.config.PSNAWP || '';
    const account_id = this.platform.config.account_id || [];
    const polling = this.platform.config.pollInterval || 120000;
    const account_ids: string[] = account_id.map((acc) => acc.id);

    if (this.titleUpdateInterval) clearInterval(this.titleUpdateInterval);

    this.titleUpdateInterval = setInterval(() => {
      const scriptPath = path.join(__dirname, 'title_game.py');
      const get_title = spawn('python3', [scriptPath, PSNAWP, JSON.stringify(account_ids)]);

      get_title.stdout.on('data', (data) => {
        const newTitle = data.toString().trim();
        if (newTitle && newTitle !== this.lastTitle && this.dynamicTitleSource) {
          this.lastTitle = newTitle;
          this.platform.log.info(`🎮 Updating title to: ${newTitle}`);
          this.dynamicTitleSource
            .setCharacteristic(this.Characteristic.Name, newTitle)
            .setCharacteristic(this.Characteristic.ConfiguredName, newTitle);
        }
      });

      get_title.stderr.on('data', (err) => {
        this.platform.log.error('⚠️ Error fetching title:', err.toString());
      });
    }, polling);
  }

  private async discoverDevice() {
    const device = Device.withId(this.deviceInformation.id);
    this.deviceInformation = await device.discover();
    return device;
  }

  private async getOn(): Promise<CharacteristicValue> {
    return this.deviceInformation.status === DeviceStatus.AWAKE;
  }

private setOn(value: CharacteristicValue): void {
  if (this.lockSetOn) {
    throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.RESOURCE_BUSY);
  }

  this.addLocks();

  this.tvService
    .getCharacteristic(this.Characteristic.Active)
    .updateValue(value);

  void (async () => {
    try {
      const device = await this.discoverDevice();
      this.deviceInformation = await device.discover();

      const currentStatus = this.deviceInformation.status;
      const desiredStatus = value ? DeviceStatus.AWAKE : DeviceStatus.STANDBY;

      if (currentStatus === desiredStatus) {
        this.platform.log.debug(`[${this.deviceInformation.id}] Already in desired state`);
        return;
      }

      try {
        const connection = await device.openConnection();

        if (value) {
          this.platform.log.debug(`[${this.deviceInformation.id}] Waking device...`);
          await timeout(device.wake(), 15_000);
        } else {
          this.platform.log.debug(`[${this.deviceInformation.id}] Sending standby...`);
          await timeout(connection.standby(), 15_000);
        }

        await connection.close();
      } catch (err) {
        const message = (err as Error).message;
        if (message.includes('403') && message.includes('Remote is already in use')) {
          this.platform.log.warn(`[${this.deviceInformation.id}] Remote already in use — assuming console is on.`);
          await this.updateDeviceInformations(true);
        } else {
          throw err;
        }
      }

    } catch (err) {
      const message = (err as Error).message;
      this.platform.log.error(`[${this.deviceInformation.id}] Background error: ${message}`);
    } finally {
      this.releaseLocks();
      await this.updateDeviceInformations(true);
    }
  })();
}



  private async setTitleSwitchState(value: CharacteristicValue) {
    const requestedTitle = this.titleIDs[value as number] || null;
    if (!requestedTitle) return;

    if (this.lockSetOn) {
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.RESOURCE_BUSY);
    }

    this.addLocks();

    try {
      const device = await this.discoverDevice();

      if (this.deviceInformation.extras['running-app-titleid'] === requestedTitle) return;

      const connection = await device.openConnection();
      await connection.startTitleId?.(requestedTitle);
      await connection.close();
    } catch (err) {
      this.platform.log.error((err as Error).message);
    } finally {
      this.releaseLocks();
    }
  }

  private async updateDeviceInformations(force = false) {
    if (this.lockUpdate && !force) return;

    this.lockUpdate = true;

    try {
      await this.discoverDevice();
    } catch {
      this.deviceInformation.status = DeviceStatus.STANDBY;
    } finally {
      this.lockUpdate = false;
      this.tvService
        .getCharacteristic(this.platform.Characteristic.Active)
        .updateValue(this.deviceInformation.status === DeviceStatus.AWAKE);
    }
  }

  private addLocks() {
    this.lockSetOn = true;
    this.lockUpdate = true;
    this.lockTimeout = setTimeout(() => {
      this.releaseLocks();
    }, this.kLockTimeout);
  }

  private releaseLocks() {
    this.lockSetOn = false;
    this.lockUpdate = false;
    if (this.lockTimeout) {
      clearTimeout(this.lockTimeout);
    }
  }
}