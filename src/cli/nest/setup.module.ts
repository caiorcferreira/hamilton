import { Module } from "@nestjs/common";
import {
  createSetupRuntime,
  SETUP_BUNDLE_LOCATOR,
  SETUP_FILE_SYSTEM_HOME,
} from "../setup-runtime.js";
import { SetupService } from "../setup.service.js";
import { ResultModule } from "./result.module.js";
import { SetupCommand } from "./setup.command.js";

@Module({
  imports: [ResultModule],
  providers: [
    SetupCommand,
    SetupService,
    {
      provide: SETUP_FILE_SYSTEM_HOME,
      useFactory: () => createSetupRuntime().fileSystemHome,
    },
    {
      provide: SETUP_BUNDLE_LOCATOR,
      useFactory: () => createSetupRuntime().bundleLocator,
    },
  ],
  exports: [SetupService, SETUP_FILE_SYSTEM_HOME, SETUP_BUNDLE_LOCATOR],
})
export class SetupModule {}
