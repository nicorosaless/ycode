'use client';

import React from 'react';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { useCustomerCopy } from '@/lib/rin5-customer-copy';

interface CollectionItemContextMenuProps {
  children: React.ReactNode;
  isPublishable: boolean;
  hasPublishedVersion: boolean;
  isModified: boolean;
  isCollectionPublished: boolean;
  onEdit: () => void;
  onSetAsDraft: () => void;
  onStageForPublish: () => void;
  onSetAsPublished: () => void;
  allowDirectPublish?: boolean;
  onDuplicate: () => void;
  onDelete: () => void;
  disabled?: boolean;
}

export default function CollectionItemContextMenu({
  children,
  isPublishable,
  hasPublishedVersion,
  isModified,
  isCollectionPublished,
  onEdit,
  onSetAsDraft,
  onStageForPublish,
  onSetAsPublished,
  allowDirectPublish = true,
  onDuplicate,
  onDelete,
  disabled = false,
}: CollectionItemContextMenuProps) {
  const t = useCustomerCopy();
  if (disabled) {
    return <>{children}</>;
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={onEdit}>
          {t('Edit CMS item')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={!isPublishable && !hasPublishedVersion}
          onClick={onSetAsDraft}
        >
          {t('Set as draft')}
        </ContextMenuItem>
        <ContextMenuItem
          disabled={isPublishable || hasPublishedVersion}
          onClick={onStageForPublish}
        >
          {t('Stage for publish')}
        </ContextMenuItem>
        {allowDirectPublish && (
          <ContextMenuItem
            disabled={!isCollectionPublished || (hasPublishedVersion && isPublishable && !isModified)}
            onClick={onSetAsPublished}
          >
            {t('Set as published')}
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onDuplicate}>
          {t('Duplicate')}
        </ContextMenuItem>
        <ContextMenuItem onClick={onDelete}>
          {t('Delete')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
