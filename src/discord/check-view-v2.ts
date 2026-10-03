import {
  ContainerBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js';
import type { Language } from '../domain/user-config.js';
import { dealioBrand } from './ui/brand.js';
import { assertComponentsV2Limit, dealioFooter } from './ui/components-v2.js';
import { buildTabBar } from './ui/tab-bar.js';

export interface CheckResultPresentation {
  readonly kind: 'success' | 'warning' | 'danger' | 'info';
  readonly title: string;
  readonly description: string;
  readonly metrics?: readonly { readonly label: string; readonly value: number; readonly emoji?: string }[];
}

export function buildCheckPanel(
  language: Language,
  presentation: CheckResultPresentation,
  sessionId?: string,
  disabled = false,
): ContainerBuilder {
  const colors = {
    success: dealioBrand.colors.success,
    warning: dealioBrand.colors.warning,
    danger: dealioBrand.colors.danger,
    info: dealioBrand.colors.primary,
  } as const;
  const icons = { success: '✅', warning: '⚠️', danger: '🛑', info: '🔄' } as const;
  const container = new ContainerBuilder()
    .setAccentColor(colors[presentation.kind])
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# 🔄 DEALIO · ${language === 'tr' ? 'KONTROL' : 'CHECK'}\n# ${icons[presentation.kind]} ${presentation.title}\n${presentation.description}`),
    );
  if (presentation.metrics && presentation.metrics.length > 0) {
    container
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        presentation.metrics.map((metric) => `${metric.emoji ?? '•'} **${metric.value}** ${metric.label}`).join('\n'),
      ));
  }
  if (sessionId) {
    // The check runs from Home; no tab is its own, so all four lead onward.
    container.addActionRowComponents(buildTabBar('check-v2', sessionId, language, { disabled }));
  }
  container
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(dealioFooter(language)));
  assertComponentsV2Limit([container]);
  return container;
}
