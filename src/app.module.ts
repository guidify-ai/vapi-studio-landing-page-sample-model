import { Inject, Logger, Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { existsSync } from 'fs';
import { join } from 'path';
import {
  BRAIN_SERVICE,
  ChatGptBrainAdapter,
  ClaudeBrainAdapter,
  GeminiBrainAdapter,
  GrokBrainAdapter,
  MockBrainAdapter,
  MockChatGptBrainAdapter,
  MockClaudeBrainAdapter,
  MockGeminiBrainAdapter,
  MockGrokBrainAdapter,
  ConversationEntity,
  FlowLoader,
  ProjectEntity,
  ProviderIngressEntity,
  VapiStudioModule,
  WorkflowLoader,
  StudioUiModule,
  type BrainAdapter,
} from '@guidify-ai/vapi-studio';
import { HealthController } from './health/health.controller';
import { FlowDiagramController } from './flow-diagram/flow-diagram.controller';
import { FlowDiagramService } from './flow-diagram/flow-diagram.service';
import { ConversationsController } from './conversations/conversations.controller';
import { ConversationsService } from './conversations/conversations.service';
import { StudioController } from './studio/studio.controller';
import { StudioSessionService } from './studio/studio-session.service';
import { StudioEventBuffer } from './studio/studio-event-buffer';
import { StudioLiveSpeechBuffer } from './studio/studio-live-speech.buffer';
import { RecaptchaService } from './studio/recaptcha.service';
import { FormResumeService } from './forms/form-resume.service';
import { CallerPersistenceModule } from './caller/caller-persistence.module';
import { CallerProfileEntity } from './caller/caller-profile.entity';
import { ProjectSeedService } from './project/project-seed.service';
import { VapiController } from './vapi/vapi.controller';
import { VapiWebhookGuard } from './vapi/vapi.guard';
import { VapiWebhookHandler } from './vapi/vapi.handler';
import { VapiStrategyTriager } from './vapi/vapi.triager';
import { AssistantRequestStrategy } from './vapi/strategies/assistant-request.strategy';
import { CallStartedStrategy } from './vapi/strategies/call-started.strategy';
import { StatusUpdateStrategy } from './vapi/strategies/status-update.strategy';
import { UserInterruptedStrategy } from './vapi/strategies/user-interrupted.strategy';
import { ToolCallsStrategy } from './vapi/strategies/tool-calls.strategy';
import { PlannerConversationEntry } from './conversation/entry';
import {
  DemoGreetNode,
  DemoClarifyEntryNode,
  DemoSalesEntryNode,
  DemoSalesBusinessNode,
  DemoSalesUseCaseNode,
  DemoSalesDiscoveryNode,
  DemoSalesConsentNode,
  DemoSalesNoContactEndNode,
  DemoSupportEntryNode,
  DemoSupportIssueNode,
  DemoSupportDetailNode,
  DemoSupportConsentNode,
  DemoSupportNoContactEndNode,
  DemoFeatureEntryNode,
  DemoFeatureDescriptionNode,
  DemoFeatureConsentNode,
  DemoFeatureNoContactEndNode,
  DemoDocsAnswerNode,
  DemoDocsEndNode,
  DemoContactMethodNode,
  DemoCallerPhoneConsentNode,
  DemoRequestPhoneNode,
  DemoEmitOutcomeNode,
  DemoSalesSuccessEndNode,
  DemoSupportSuccessEndNode,
  DemoFeatureSuccessEndNode,
  DemoContactFailureEndNode,
  EntrySalesIntention,
  EntryDocsIntention,
  EntrySupportIntention,
  EntryFeatureIntention,
  EntryExploringIntention,
  EntryClarifyIntention,
  SalesBusinessIntention,
  SalesUseCaseIntention,
  SalesDiscoveryIntention,
  SalesConsentYesIntention,
  SalesConsentNoIntention,
  DocsQuestionIntention,
  DocsDoneIntention,
  SupportIssueIntention,
  SupportDetailIntention,
  SupportConsentYesIntention,
  SupportConsentNoIntention,
  FeatureDescriptionIntention,
  FeatureConsentYesIntention,
  FeatureConsentNoIntention,
  PhoneReuseYesIntention,
  PhoneReuseNoIntention,
  ContactPhoneIntention,
  ContactPreferEmailIntention,
  ContactPreferCallIntention,
  ContactEmailCollectIntention,
  OptionalSkipIntention,
} from './conversation/nodes/planner/demo-conversation.nodes';
import {
  GoodbyeNode,
  ContinueNode,
  MadNode,
  StillThereNode,
  TransferToHumanNode,
  UnknownTransitionNode,
} from './conversation/nodes/portals.nodes';
import {
  MadDetectIntention,
  GibberishDetectIntention,
  SoftContinueIntention,
  NothingElseIntention,
} from './conversation/intentions/planner.intentions';
import { brainConfig } from './brain/brain.config';
import { PlannerMailModule } from './mail/planner-mail.module';
import { AdvisorModule } from './advisor/advisor.module';
import { OutboundCallService } from './studio/outbound-call.service';

function resolveBrainAdapter() {
  switch (brainConfig.adapter) {
    case 'studio-chatgpt':
      return ChatGptBrainAdapter;
    case 'studio-claude':
      return ClaudeBrainAdapter;
    case 'studio-gemini':
      return GeminiBrainAdapter;
    case 'studio-grok':
      return GrokBrainAdapter;
    case 'mock-claude':
      return MockClaudeBrainAdapter;
    case 'mock-gemini':
      return MockGeminiBrainAdapter;
    case 'mock-grok':
      return MockGrokBrainAdapter;
    case 'mock':
    case 'mock-chatgpt':
    default:
      return MockChatGptBrainAdapter;
  }
}

@Module({
  imports: [
    PlannerMailModule,
    AdvisorModule,
    TypeOrmModule.forRoot({
      type: 'postgres',
      url:
        process.env.DATABASE_URL ??
        'postgres://studio:studio@postgres:5432/studio',
      entities: [
        ConversationEntity,
        ProviderIngressEntity,
        ProjectEntity,
        CallerProfileEntity,
      ],
      synchronize: true,
    }),
    CallerPersistenceModule,
    StudioUiModule.forRoot(),
    VapiStudioModule.forRoot({
      entryPoint: PlannerConversationEntry,
      brainAdapter: resolveBrainAdapter(),
      eventListeners: [StudioEventBuffer],
      brain: {
        model: brainConfig.model,
        confidenceThreshold: brainConfig.confidenceThreshold,
      },
      intentions: [
        MadDetectIntention,
        GibberishDetectIntention,
        SoftContinueIntention,
        NothingElseIntention,
        EntrySalesIntention,
        EntryDocsIntention,
        EntrySupportIntention,
        EntryFeatureIntention,
        EntryExploringIntention,
        EntryClarifyIntention,
        SalesBusinessIntention,
        SalesUseCaseIntention,
        SalesDiscoveryIntention,
        SalesConsentYesIntention,
        SalesConsentNoIntention,
        DocsQuestionIntention,
        DocsDoneIntention,
        SupportIssueIntention,
        SupportDetailIntention,
        SupportConsentYesIntention,
        SupportConsentNoIntention,
        FeatureDescriptionIntention,
        FeatureConsentYesIntention,
        FeatureConsentNoIntention,
        PhoneReuseYesIntention,
        PhoneReuseNoIntention,
        ContactPhoneIntention,
        ContactPreferEmailIntention,
        ContactPreferCallIntention,
        ContactEmailCollectIntention,
        OptionalSkipIntention,
      ],
      nodes: [
        { className: 'DemoGreetNode', useClass: DemoGreetNode },
        { className: 'DemoClarifyEntryNode', useClass: DemoClarifyEntryNode },
        { className: 'DemoSalesEntryNode', useClass: DemoSalesEntryNode },
        { className: 'DemoSalesBusinessNode', useClass: DemoSalesBusinessNode },
        { className: 'DemoSalesUseCaseNode', useClass: DemoSalesUseCaseNode },
        {
          className: 'DemoSalesDiscoveryNode',
          useClass: DemoSalesDiscoveryNode,
        },
        { className: 'DemoSalesConsentNode', useClass: DemoSalesConsentNode },
        {
          className: 'DemoSalesNoContactEndNode',
          useClass: DemoSalesNoContactEndNode,
        },
        { className: 'DemoSupportEntryNode', useClass: DemoSupportEntryNode },
        { className: 'DemoSupportIssueNode', useClass: DemoSupportIssueNode },
        { className: 'DemoSupportDetailNode', useClass: DemoSupportDetailNode },
        {
          className: 'DemoSupportConsentNode',
          useClass: DemoSupportConsentNode,
        },
        {
          className: 'DemoSupportNoContactEndNode',
          useClass: DemoSupportNoContactEndNode,
        },
        { className: 'DemoFeatureEntryNode', useClass: DemoFeatureEntryNode },
        {
          className: 'DemoFeatureDescriptionNode',
          useClass: DemoFeatureDescriptionNode,
        },
        {
          className: 'DemoFeatureConsentNode',
          useClass: DemoFeatureConsentNode,
        },
        {
          className: 'DemoFeatureNoContactEndNode',
          useClass: DemoFeatureNoContactEndNode,
        },
        { className: 'DemoDocsAnswerNode', useClass: DemoDocsAnswerNode },
        { className: 'DemoDocsEndNode', useClass: DemoDocsEndNode },
        { className: 'DemoContactMethodNode', useClass: DemoContactMethodNode },
        {
          className: 'DemoCallerPhoneConsentNode',
          useClass: DemoCallerPhoneConsentNode,
        },
        { className: 'DemoRequestPhoneNode', useClass: DemoRequestPhoneNode },
        { className: 'DemoEmitOutcomeNode', useClass: DemoEmitOutcomeNode },
        {
          className: 'DemoSalesSuccessEndNode',
          useClass: DemoSalesSuccessEndNode,
        },
        {
          className: 'DemoSupportSuccessEndNode',
          useClass: DemoSupportSuccessEndNode,
        },
        {
          className: 'DemoFeatureSuccessEndNode',
          useClass: DemoFeatureSuccessEndNode,
        },
        {
          className: 'DemoContactFailureEndNode',
          useClass: DemoContactFailureEndNode,
        },
        { className: 'GoodbyeNode', useClass: GoodbyeNode },
        { className: 'ContinueNode', useClass: ContinueNode },
        { className: 'MadNode', useClass: MadNode },
        { className: 'UnknownTransitionNode', useClass: UnknownTransitionNode },
        { className: 'TransferToHumanNode', useClass: TransferToHumanNode },
        { className: 'StillThereNode', useClass: StillThereNode },
      ],
    }),
  ],
  controllers: [
    HealthController,
    FlowDiagramController,
    ConversationsController,
    StudioController,
    VapiController,
  ],
  providers: [
    FlowDiagramService,
    ConversationsService,
    StudioEventBuffer,
    StudioLiveSpeechBuffer,
    StudioSessionService,
    OutboundCallService,
    RecaptchaService,
    FormResumeService,
    ProjectSeedService,
    VapiWebhookGuard,
    VapiWebhookHandler,
    VapiStrategyTriager,
    AssistantRequestStrategy,
    CallStartedStrategy,
    StatusUpdateStrategy,
    UserInterruptedStrategy,
    ToolCallsStrategy,
  ],
})
export class AppModule implements OnModuleInit {
  private readonly logger = new Logger(AppModule.name);

  constructor(
    private readonly flowLoader: FlowLoader,
    private readonly workflows: WorkflowLoader,
    @Inject(BRAIN_SERVICE) private readonly brain: BrainAdapter,
  ) {}

  async onModuleInit(): Promise<void> {
    const configDir = process.env.CONFIG_DIR ?? join(process.cwd(), 'config');
    const squadPath = join(configDir, 'workflow.yaml');
    if (existsSync(squadPath)) {
      this.workflows.loadFromFile(squadPath);
    }
    if (this.workflows.hasWorkflow()) {
      const wf = this.workflows.getWorkflow();
      const entry = this.workflows.getModule(wf.entryModuleId);
      if (entry.kind === 'studio' && entry.flowFile) {
        this.flowLoader.loadFromFile(join(configDir, entry.flowFile));
      } else {
        this.flowLoader.loadFromFile(join(configDir, 'flow.yaml'));
      }
      this.logger.log(
        `Workflow ${wf.id} entry=${wf.entryModuleId} modules=${Object.keys(wf.modules).join(',')}`,
      );
    } else {
      this.flowLoader.loadFromFile(join(configDir, 'flow.yaml'));
      this.logger.log(
        'Landing demo: config/flow.yaml (config/demo-conversation.yml)',
      );
    }

    this.logger.log(
      `Brain driver=${brainConfig.adapter} model=${brainConfig.model} threshold=${brainConfig.confidenceThreshold}`,
    );

    if (this.brain instanceof MockBrainAdapter) {
      this.brain.loadProfile(
        'planner',
        join(configDir, 'poc', 'planner.brain.yml'),
      );
      this.brain.loadProfile(
        'state-machine',
        join(configDir, 'poc', 'state-machine.brain.yml'),
      );
      this.brain.loadProfile(
        'transfer-human',
        join(configDir, 'poc', 'transfer-human.brain.yml'),
      );
      this.brain.loadProfile(
        'pause-resume',
        join(configDir, 'poc', 'pause-resume.brain.yml'),
      );
      const profile = process.env.POC_BRAIN_PROFILE ?? 'planner';
      this.brain.setActiveProfile(profile);
    }
  }
}
