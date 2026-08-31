import { Injectable } from '@angular/core'
import { ConfigProvider } from 'tabby-core'
import { AI_PROGRESS_DEFAULTS } from './defaults'

@Injectable()
export class AiProgressConfigProvider extends ConfigProvider {
    defaults = {
        aiProgress: AI_PROGRESS_DEFAULTS,
    }
}
