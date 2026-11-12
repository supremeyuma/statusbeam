import { Controller, Get } from '@nestjs/common';

export interface ServiceInfo {
  name: string;
  version: string;
}

@Controller()
export class AppController {
  @Get()
  getServiceInfo(): ServiceInfo {
    return { name: 'statusbeam-api', version: '0.0.0' };
  }
}
