import { Global, Module } from '@nestjs/common';
import { DocsAdvisorService } from './docs-advisor.service';
import { ScenarioAdvisorService } from './scenario-advisor.service';

@Global()
@Module({
  providers: [ScenarioAdvisorService, DocsAdvisorService],
  exports: [ScenarioAdvisorService, DocsAdvisorService],
})
export class AdvisorModule {}
