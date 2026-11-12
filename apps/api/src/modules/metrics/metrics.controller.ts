import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';

import { MetricsService } from '../../common/metrics.service';

@Controller()
export class MetricsController {
  public constructor(private readonly metrics: MetricsService) {}

  @Get('metrics')
  public async scrape(@Res() res: Response): Promise<void> {
    res.type(this.metrics.contentType).send(await this.metrics.render());
  }
}
