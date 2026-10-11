import { Copy, Ellipsis, OctagonX, SquarePen, UserPlus, Waves } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { SquadronActionsOffered } from '../../../lib/squadrons-view';
import { Button } from '../../../components/atoms/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../../../components/atoms/dropdown-menu';
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '../../../components/atoms/sheet';
import { showToast } from '../../../components/atoms/toast';

interface SquadronActionsProps {
  squadronId: string;
  offered: SquadronActionsOffered;
  onAddMember: () => void;
  onMessageFlagship: () => void;
  onStandDown: () => void;
  onForceStandDown: () => void;
}

interface MenuAction {
  key: string;
  label: string;
  icon: LucideIcon;
  testId: string;
  isDestructive?: boolean;
  onSelect: () => void;
}

/**
 * The squadron header's actions (canvas, SqSailing, SqMenu, MSqMenu): Add
 * member and Message to the flagship as buttons, and the Squadron actions
 * menu, a DropdownMenu on desktop and a bottom Sheet on phone, with Copy
 * squadron id and, apart, Stand down and Force stand down.
 */
export function SquadronActions({ squadronId, offered, onAddMember, onMessageFlagship, onStandDown, onForceStandDown }: SquadronActionsProps) {
  const copyId = async () => {
    // The clipboard is missing outside a secure context, and may refuse: either way the id is shown to copy by hand.
    try {
      await navigator.clipboard.writeText(squadronId);
      showToast({ title: 'Squadron id copied', description: squadronId, tone: 'success' });
    } catch {
      showToast({ title: 'Couldn’t copy the squadron id', description: squadronId, tone: 'error' });
    }
  };
  const copy: MenuAction = { key: 'copy', label: 'Copy squadron id', icon: Copy, testId: 'squadron-copy-id', onSelect: () => void copyId() };
  const endings: MenuAction[] = [
    ...(offered.canStandDown ? [{ key: 'stand-down', label: 'Stand down…', icon: Waves, testId: 'squadron-stand-down', isDestructive: true, onSelect: onStandDown }] : []),
    ...(offered.canForceStandDown
      ? [{ key: 'force', label: 'Force stand down…', icon: OctagonX, testId: 'squadron-force-stand-down', isDestructive: true, onSelect: onForceStandDown }]
      : []),
  ];
  const trigger = (size: 'xs' | 'touch') => (
    <Button size={size} variant="ghost" isIconOnly aria-label="Squadron actions" icon={<Ellipsis />} data-testid="squadron-actions" />
  );
  return (
    <div className="flex items-center gap-2">
      {offered.canAddMember && (
        <Button size="xs" icon={<UserPlus />} data-testid="squadron-add-member" onClick={onAddMember}>
          Add member
        </Button>
      )}
      {offered.canMessageFlagship && (
        <Button size="xs" icon={<SquarePen />} data-testid="squadron-message-flagship" onClick={onMessageFlagship}>
          Message
        </Button>
      )}
      <div className="max-sm:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger render={trigger('xs')} />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={copy.onSelect} data-testid={copy.testId}>
              <Copy aria-hidden />
              {copy.label}
            </DropdownMenuItem>
            {endings.length > 0 && <DropdownMenuSeparator />}
            {endings.map((action) => (
              <DropdownMenuItem key={action.key} variant="destructive" onClick={action.onSelect} data-testid={action.testId}>
                <action.icon aria-hidden />
                {action.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="sm:hidden">
        <Sheet>
          <SheetTrigger render={trigger('touch')} />
          <SheetContent side="bottom" data-testid="squadron-actions-sheet">
            <SheetHeader>
              <SheetTitle>{squadronId}</SheetTitle>
            </SheetHeader>
            <ul className="flex flex-col pb-2">
              {[copy, ...endings].map((action, index) => (
                <li key={action.key} className={index === 1 ? 'mt-1 border-t border-border pt-1' : undefined}>
                  <SheetClose
                    render={<button type="button" onClick={action.onSelect} />}
                    className={`flex h-(--size-control-touch) w-full items-center gap-3 px-4 text-left text-body-touch [&_svg]:size-(--size-icon) [&_svg]:shrink-0 ${action.isDestructive === true ? 'text-destructive-text' : 'text-foreground'}`}
                  >
                    <action.icon aria-hidden />
                    {action.label.replace(/…$/, '')}
                  </SheetClose>
                </li>
              ))}
            </ul>
            <div className="px-4 pb-4">
              <SheetClose render={<Button size="touch" className="w-full" />}>Cancel</SheetClose>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
