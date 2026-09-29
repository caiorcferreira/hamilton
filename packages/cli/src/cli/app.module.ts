import { Module } from "@nestjs/common";
import { WorkbenchModule } from "./nest/workbench.module.js";
import { KeplerRootCommand } from "./nest/root.command.js";
import { SetupModule } from "./nest/setup.module.js";

@Module({
  imports: [SetupModule, WorkbenchModule],
  providers: [KeplerRootCommand],
})
export class AppModule {}
