import CapRoverAPI, { SimpleAuthenticationProvider, CapRoverModels } from 'caprover-api';
import { GlobalConfig } from './types';

type IAppDef = CapRoverModels.IAppDef;

export class CapRoverClient {
  private api: CapRoverAPI;

  constructor(config: GlobalConfig) {
    this.api = new CapRoverAPI(
      config.caproverUrl,
      new SimpleAuthenticationProvider(() =>
        Promise.resolve({ password: config.caproverPass })
      )
    );
  }

  async getAllAppDefinitions(): Promise<IAppDef[]> {
    const resp = await this.api.getAllApps();
    return resp.appDefinitions;
  }

  async setInstanceCount(appName: string, count: number, allApps?: IAppDef[]): Promise<void> {
    const apps = allApps ?? (await this.getAllAppDefinitions());
    const app = apps.find((a) => a.appName === appName);
    if (!app) throw new Error(`CapRover app not found: ${appName}`);
    await this.api.updateConfigAndSave(appName, { ...app, instanceCount: count });
  }
}
