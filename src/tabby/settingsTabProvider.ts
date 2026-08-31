import { Injectable } from '@angular/core'
import { SettingsTabProvider } from 'tabby-settings'
import { AiProgressSettingsTabComponent } from './settingsTab.component'

@Injectable()
export class AiProgressSettingsTabProvider extends SettingsTabProvider {
    id = 'ai-progress'
    icon = 'fas fa-spinner'
    title = 'AI Progress'
    weight = 10

    getComponentType (): any { return AiProgressSettingsTabComponent }
}
