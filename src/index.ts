import { CommonModule } from '@angular/common'
import { NgModule } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { ConfigProvider } from 'tabby-core'
import { SettingsTabProvider } from 'tabby-settings'
import { TerminalDecorator } from 'tabby-terminal'
import { AiProgressConfigProvider } from './config/configProvider'
import { AiProgressSettingsTabComponent } from './tabby/settingsTab.component'
import { AiProgressSettingsTabProvider } from './tabby/settingsTabProvider'
import { AiProgressDecorator } from './tabby/terminalDecorator'

@NgModule({
    imports: [CommonModule, FormsModule],
    declarations: [AiProgressSettingsTabComponent],
    providers: [
        { provide: TerminalDecorator, useClass: AiProgressDecorator, multi: true },
        { provide: ConfigProvider, useClass: AiProgressConfigProvider, multi: true },
        { provide: SettingsTabProvider, useClass: AiProgressSettingsTabProvider, multi: true },
    ],
})
export default class AiProgressModule {}
