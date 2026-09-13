'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface SettingsRowProps {
  icon?: React.ReactNode
  title: string
  description?: React.ReactNode
  control?: React.ReactNode
  children?: React.ReactNode
  className?: string
}

function labelToggleControl(
  control: React.ReactNode,
  titleId: string,
  descriptionId?: string,
): React.ReactNode {
  if (!React.isValidElement(control)) return control

  const props = control.props as {
    checked?: unknown
    onCheckedChange?: unknown
    'aria-labelledby'?: string
    'aria-label'?: string
  }

  const looksLikeToggle = 'onCheckedChange' in props || 'checked' in props
  if (!looksLikeToggle || props['aria-labelledby'] || props['aria-label']) {
    return control
  }

  return React.cloneElement(control, {
    'aria-labelledby': titleId,
    ...(descriptionId ? { 'aria-describedby': descriptionId } : {}),
  } as Partial<typeof props>)
}

export function SettingsRow({
  icon,
  title,
  description,
  control,
  children,
  className,
}: SettingsRowProps) {
  const titleId = React.useId()
  const descriptionId = React.useId()
  const labelledControl = control
    ? labelToggleControl(control, titleId, description ? descriptionId : undefined)
    : null

  return (
    <div className={cn('rounded-xl bg-stone-50 px-4 py-3.5', className)}>
      <div className="flex items-center gap-3">
        {icon ? (
          <div className="shrink-0 text-stone-400 [&>svg]:h-4 [&>svg]:w-4" aria-hidden>
            {icon}
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <div id={titleId} className="font-medium text-stone-900">
            {title}
          </div>
          {description ? (
            <div id={descriptionId} className="mt-0.5 text-sm text-stone-600">
              {description}
            </div>
          ) : null}
        </div>
        {labelledControl ? (
          <div className="flex shrink-0 items-center self-center">{labelledControl}</div>
        ) : null}
      </div>
      {children ? <div className="mt-3 min-w-0 space-y-3">{children}</div> : null}
    </div>
  )
}

export function SettingsSection({
  title,
  children,
  className,
}: {
  title?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('space-y-2', className)}>
      {title ? (
        <h3 className="px-1 text-[11px] font-medium uppercase tracking-wider text-stone-500">
          {title}
        </h3>
      ) : null}
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  )
}
