import { Module } from "@nestjs/common";
import { WorkbenchModule } from "./nest/workbench.module.js";
import { HamiltonRootCommand } from "./nest/root.command.js";
import { SetupModule } from "./nest/setup.module.js";

@Module({
  imports: [SetupModule, WorkbenchModule],
  providers: [HamiltonRootCommand],
})
export class AppModule {}
