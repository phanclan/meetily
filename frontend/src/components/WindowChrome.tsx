'use client';

import { PanelLeft } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { isNoteWorkspaceRoute } from '@/lib/quickNoteRoute';
import { cn } from '@/lib/utils';

/**
 * Fallback top strip for loading / gaps. Real focused drag is the 36px chrome
 * bars in the sidebar and main column — those sit above this layer.
 *
 * Starts after the traffic-light cluster so WKWebView does not steal light hits.
 */
export function WindowChrome() {
  return (
    <div data-tauri-drag-region="deep" aria-hidden className="window-chrome-drag-strip titlebar" />
  );
}

/** Dedicated 36px Overlay drag bar. Interactive children must use `.no-drag`. */
export function ChromeDragBar({
  children,
  className,
  insetLeft = false,
}: {
  children?: React.ReactNode;
  className?: string;
  insetLeft?: boolean;
}) {
  const pathname = usePathname();
  const { isCollapsed, toggleCollapse } = useSidebar();
  const showCollapsedToggle = isCollapsed && !isNoteWorkspaceRoute(pathname);

  const bar = (
    <div
      data-tauri-drag-region="deep"
      className={cn(
        // shrink-0 only: flex-1 here grows the bar in column shells (Home/Ask) and
        // vertically centers New note when Ask expands. Horizontal fill belongs on the parent.
        'window-chrome-header window-chrome-toolbar titlebar pointer-events-auto flex min-w-0 shrink-0 items-center',
        insetLeft && 'window-chrome-inset-left',
      )}
    >
      {showCollapsedToggle && (
        <div className="no-drag flex shrink-0 items-center">
          <button
            type="button"
            onClick={toggleCollapse}
            className="rounded-md p-1.5 text-stone-500 hover:bg-stone-100 hover:text-stone-800"
            aria-label="Expand sidebar"
            aria-expanded={false}
          >
            <PanelLeft className="h-4 w-4" />
          </button>
        </div>
      )}
      <div className={cn('flex min-h-[var(--window-chrome-header-height)] min-w-0 flex-1 items-center', className)}>
        {children}
      </div>
    </div>
  );

  if (!showCollapsedToggle) return bar;

  return (
    <div className="relative z-30 flex shrink-0 items-stretch">
      <div className="window-chrome-collapsed-clearance" aria-hidden />
      {bar}
    </div>
  );
}

