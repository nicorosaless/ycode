'use client';

import { useCallback, useRef, useEffect, useState, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useEditorUrl } from '@/hooks/use-editor-url';
import { findHomepage } from '@/lib/page-utils';
import { getTranslationValue } from '@/lib/localisation-utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
// 4. Stores
import { useEditorStore } from '@/stores/useEditorStore';
import { usePagesStore } from '@/stores/usePagesStore';
import { useCollectionsStore } from '@/stores/useCollectionsStore';
import { useLocalisationStore } from '@/stores/useLocalisationStore';

import { buildSlugPath, buildDynamicPageUrl, buildLocalizedSlugPath, buildLocalizedDynamicPageUrl } from '@/lib/page-utils';

// 5. Types
import type { Page } from '@/types';
import type { User } from '@supabase/supabase-js';
import ActiveUsersInHeader from './ActiveUsersInHeader';
import InviteUserButton from './InviteUserButton';
import { LocaleSelector } from './LocaleSelector';
import PublishPopover from './PublishPopover';
import { Label } from '@/components/ui/label';
import Icon from '@/components/ui/icon';
import { Separator } from '@/components/ui/separator';
import { BackupRestoreDialog } from '@/components/project/BackupRestoreDialog';
import { isCloudVersion } from '@/lib/utils';
import { useRole } from '@/hooks/use-role';
import BrandLogo from '@/components/BrandLogo';
import type { Rin5Navigation } from '@/lib/rin5-navigation';
import { Rin5CustomerLocalizationNav } from './CustomerWorkspaceAccess';

interface HeaderBarProps {
  user: User | null;
  signOut: () => Promise<void>;
  showPageDropdown: boolean;
  setShowPageDropdown: (show: boolean) => void;
  currentPage: Page | undefined;
  currentPageId: string | null;
  pages: Page[];
  setCurrentPageId: (id: string) => void;
  isSaving: boolean;
  hasUnsavedChanges: boolean;
  lastSaved: Date | null;
  isPublishing: boolean;
  setIsPublishing: (isPublishing: boolean) => void;
  saveImmediately: (pageId: string) => Promise<void>;
  activeTab: 'pages' | 'layers' | 'cms';
  onExitComponentEditMode?: () => void;
  onPublishSuccess: () => void;
  isSettingsRoute?: boolean;
  rin5Navigation?: Rin5Navigation | null;
}

export default function HeaderBar({
  user,
  signOut,
  showPageDropdown,
  setShowPageDropdown,
  currentPage,
  currentPageId,
  pages,
  setCurrentPageId,
  isSaving,
  hasUnsavedChanges,
  lastSaved,
  isPublishing,
  setIsPublishing,
  saveImmediately,
  activeTab,
  onExitComponentEditMode,
  onPublishSuccess,
  isSettingsRoute = false,
  rin5Navigation = null,
}: HeaderBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const pageDropdownRef = useRef<HTMLDivElement>(null);
  const { isEditor, canManageSettings, canManageMembers } = useRole();
  const editorSidebarTab = useEditorStore((s) => s.activeSidebarTab);
  const currentPageCollectionItemId = useEditorStore((s) => s.currentPageCollectionItemId);
  const storeCurrentPageId = useEditorStore((s) => s.currentPageId);
  const isPreviewMode = useEditorStore((s) => s.isPreviewMode);
  const setPreviewMode = useEditorStore((s) => s.setPreviewMode);
  const openFileManager = useEditorStore((s) => s.openFileManager);
  const setKeyboardShortcutsOpen = useEditorStore((s) => s.setKeyboardShortcutsOpen);
  const setActiveSidebarTab = useEditorStore((s) => s.setActiveSidebarTab);
  const lastDesignUrl = useEditorStore((s) => s.lastDesignUrl);
  const setLastDesignUrl = useEditorStore((s) => s.setLastDesignUrl);
  const previewReturnUrl = useEditorStore((s) => s.previewReturnUrl);
  const previewReturnTab = useEditorStore((s) => s.previewReturnTab);
  const setPreviewReturn = useEditorStore((s) => s.setPreviewReturn);

  const folders = usePagesStore((s) => s.folders);
  const storePages = usePagesStore((s) => s.pages);

  const items = useCollectionsStore((s) => s.items);
  const fields = useCollectionsStore((s) => s.fields);
  const collections = useCollectionsStore((s) => s.collections);
  const storeSelectedCollectionId = useCollectionsStore((s) => s.selectedCollectionId);
  const setSelectedCollectionId = useCollectionsStore((s) => s.setSelectedCollectionId);

  const locales = useLocalisationStore((s) => s.locales);
  const selectedLocaleId = useLocalisationStore((s) => s.selectedLocaleId);
  const translations = useLocalisationStore((s) => s.translations);
  const { navigateToLayers, navigateToCollection, navigateToCollections, updateQueryParams, routeType } = useEditorUrl();

  // Optimistic nav button state - set immediately on click, cleared when URL catches up
  type NavButton = 'design' | 'cms' | 'forms' | 'localization';
  const [optimisticNav, setOptimisticNav] = useState<NavButton | null>(null);

  // Clear optimistic state once the URL reflects the clicked route
  useEffect(() => {
    if (!optimisticNav) return;
    const isDesignRoute = routeType === 'layers' || routeType === 'page' || routeType === 'component' || routeType === null;
    const isCmsRoute = routeType === 'collection' || routeType === 'collections-base';
    const isFormsRoute = routeType === 'forms';
    const isLocalizationRoute = routeType === 'localization';

    if (
      (optimisticNav === 'design' && isDesignRoute) ||
      (optimisticNav === 'cms' && isCmsRoute) ||
      (optimisticNav === 'forms' && isFormsRoute) ||
      (optimisticNav === 'localization' && isLocalizationRoute)
    ) {
      setOptimisticNav(null);
    }
  }, [routeType, optimisticNav]);

  // Turn off preview mode only after navigation to the return route completes,
  // keeping the preview overlay visible during the transition to avoid flashing
  useEffect(() => {
    if (!isPreviewMode || previewReturnUrl) return;
    const isDesignRoute = routeType === 'layers' || routeType === 'page' || routeType === 'component' || routeType === null;
    if (!isDesignRoute) {
      setPreviewMode(false);
    }
  }, [routeType, isPreviewMode, previewReturnUrl, setPreviewMode]);

  // Derive active button: optimistic state takes priority, then URL
  const activeNavButton = useMemo((): NavButton | null => {
    if (optimisticNav) return optimisticNav;
    if (routeType === 'collection' || routeType === 'collections-base') return 'cms';
    if (routeType === 'forms') return 'forms';
    if (routeType === 'localization') return 'localization';
    if (routeType === 'layers' || routeType === 'page' || routeType === 'component' || routeType === null) return 'design';
    return null;
  }, [optimisticNav, routeType]);

  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      const savedTheme = localStorage.getItem('theme') as 'system' | 'light' | 'dark' | null;
      return savedTheme || 'dark';
    }
    return 'dark';
  });
  const [baseUrl, setBaseUrl] = useState<string>('');
  const [showTransferDialog, setShowTransferDialog] = useState(false);

  // Get current host after mount
  useEffect(() => {
    setBaseUrl(window.location.protocol + '//' + window.location.host);
  }, []);

  // Get selected locale (computed from subscribed store values)
  const selectedLocale = useMemo(() => {
    if (!selectedLocaleId) return null;
    return locales.find(l => l.id === selectedLocaleId) || null;
  }, [selectedLocaleId, locales]);

  // Get translations for the selected locale
  const localeTranslations = useMemo(() => {
    return selectedLocaleId ? translations[selectedLocaleId] : undefined;
  }, [selectedLocaleId, translations]);

  // Build full page path including folders (memoized for performance)
  const fullPagePath = useMemo(() => {
    if (!currentPage) return '/';
    return buildSlugPath(currentPage, folders, 'page');
  }, [currentPage, folders]);

  // Build localized page path with translated slugs
  const localizedPagePath = useMemo(() => {
    // If no current page, use homepage for localization route
    const pageToUse = currentPage || (isSettingsRoute ? findHomepage(storePages) : null);

    if (!pageToUse) return '/';

    return buildLocalizedSlugPath(
      pageToUse,
      folders,
      'page',
      selectedLocale,
      localeTranslations
    );
  }, [currentPage, isSettingsRoute, storePages, folders, selectedLocale, localeTranslations]);

  // Get collection item slug value for dynamic pages (with translation support)
  const collectionItemSlug = useMemo(() => {
    if (!currentPage?.is_dynamic || !currentPageCollectionItemId) {
      return null;
    }

    const collectionId = currentPage.settings?.cms?.collection_id;
    const slugFieldId = currentPage.settings?.cms?.slug_field_id;

    if (!collectionId || !slugFieldId) {
      return null;
    }

    // Find the item in the store
    const collectionItems = items[collectionId] || [];
    const selectedItem = collectionItems.find(item => item.id === currentPageCollectionItemId);

    if (!selectedItem || !selectedItem.values) {
      return null;
    }

    // Get the slug value from the item's values
    let slugValue = selectedItem.values[slugFieldId];

    // If locale is selected, check for translated slug
    if (localeTranslations && slugValue) {
      const collectionFields = fields[collectionId] || [];
      const slugField = collectionFields.find((f: { id: string; key: string | null }) => f.id === slugFieldId);

      if (slugField) {
        // Build translation key: field:key:{key} or field:id:{id}
        const contentKey = slugField.key
          ? `field:key:${slugField.key}`
          : `field:id:${slugField.id}`;
        const translationKey = `cms:${currentPageCollectionItemId}:${contentKey}`;
        const translation = localeTranslations[translationKey];

        const translatedSlug = getTranslationValue(translation);
        if (translatedSlug) {
          slugValue = translatedSlug;
        }
      }
    }

    return slugValue || null;
  }, [currentPage, currentPageCollectionItemId, items, fields, localeTranslations]);

  // Build preview URL (special handling for error pages and dynamic pages)
  const previewUrl = useMemo(() => {
    if (!currentPage) return '';

    // Error pages use special preview route
    if (currentPage.error_page !== null) {
      return `/ycode/preview/error-pages/${currentPage.error_page}`;
    }

    // For dynamic pages, use localized dynamic URL builder
    const path = currentPage.is_dynamic
      ? buildLocalizedDynamicPageUrl(currentPage, folders, collectionItemSlug, selectedLocale, localeTranslations)
      : localizedPagePath;

    return `/ycode/preview${path === '/' ? '' : path}`;
  }, [currentPage, folders, localizedPagePath, collectionItemSlug, selectedLocale, localeTranslations]);

  // Build published URL (for the link in the center)
  const publishedUrl = useMemo(() => {
    // If no current page, use homepage for localization route
    const pageToUse = currentPage || (isSettingsRoute ? findHomepage(storePages) : null);
    if (!pageToUse) return '';

    // For dynamic pages, use localized dynamic URL builder
    const path = pageToUse.is_dynamic
      ? buildLocalizedDynamicPageUrl(pageToUse, folders, collectionItemSlug, selectedLocale, localeTranslations)
      : localizedPagePath;

    return path === '/' ? '' : path;
  }, [currentPage, isSettingsRoute, storePages, folders, localizedPagePath, collectionItemSlug, selectedLocale, localeTranslations]);

  // Toggle preview mode (shared by the header button and the ⌘P shortcut)
  const handleTogglePreview = useCallback(() => {
    if (!currentPage || isSaving) return;

    if (isPreviewMode) {
      if (previewReturnUrl) {
        // Navigate back while keeping preview visible — the useEffect
        // above will turn off preview once the route change completes
        if (previewReturnTab) {
          setActiveSidebarTab(previewReturnTab);
        }
        router.push(previewReturnUrl);
        setPreviewReturn(null);
        return;
      }

      setPreviewMode(false);
      updateQueryParams({ preview: undefined });
      return;
    }

    setPreviewMode(true);

    // Preview renders the current page, so when invoked from a non-design
    // route (CMS, forms, etc.) we need to jump to the layers view first
    const isDesignRoute = routeType === 'layers' || routeType === 'page' || routeType === 'component' || routeType === null;
    if (!isDesignRoute && currentPageId) {
      setPreviewReturn(window.location.pathname + window.location.search, activeTab);
      setActiveSidebarTab('layers');
      const params = new URLSearchParams(window.location.search);
      params.set('preview', 'true');
      router.push(`/ycode/layers/${currentPageId}?${params.toString()}`);
      return;
    }

    updateQueryParams({ preview: 'true' });
  }, [
    currentPage,
    currentPageId,
    isSaving,
    isPreviewMode,
    previewReturnUrl,
    previewReturnTab,
    routeType,
    activeTab,
    router,
    setActiveSidebarTab,
    setPreviewMode,
    setPreviewReturn,
    updateQueryParams,
  ]);

  // Listen for the ⌘P shortcut dispatched from the global keyboard handler
  useEffect(() => {
    const handleTogglePreviewEvent = () => handleTogglePreview();
    window.addEventListener('togglePreview', handleTogglePreviewEvent);
    return () => window.removeEventListener('togglePreview', handleTogglePreviewEvent);
  }, [handleTogglePreview]);

  // Apply theme to HTML element
  useEffect(() => {
    const root = document.documentElement;

    if (theme === 'system') {
      const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (systemPrefersDark) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
    } else if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

    localStorage.setItem('theme', theme);
  }, [theme]);

  // Close page dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (pageDropdownRef.current && !pageDropdownRef.current.contains(event.target as Node)) {
        setShowPageDropdown(false);
      }
    };

    if (showPageDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showPageDropdown, setShowPageDropdown]);

  return (
    <>
    <header className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b bg-background px-2 py-2 md:h-14 md:grid-cols-3 md:px-4 md:py-0">
      {/* Left: Logo & Navigation */}
      <div className="flex min-w-0 items-center gap-1 md:gap-2">

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary" size="sm"
              className="size-8!"
            >
              <BrandLogo compact className="text-xs" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {isCloudVersion() && (
              <>
                <DropdownMenuItem asChild>
                  <a href="https://rin5.app/dashboard">
                    Dashboard
                  </a>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {canManageSettings && (
              <DropdownMenuItem
                onClick={() => router.push('/ycode/settings/general')}
              >
                Settings
              </DropdownMenuItem>
            )}

            <DropdownMenuItem
              onClick={() => openFileManager()}
            >
              File manager
            </DropdownMenuItem>

            {canManageSettings && (
              <>
                <DropdownMenuItem
                  onClick={() => router.push('/ycode/integrations/apps')}
                >
                  Integrations
                </DropdownMenuItem>

                <DropdownMenuItem
                  onClick={() => setShowTransferDialog(true)}
                >
                  Backup &amp; Restore
                </DropdownMenuItem>
              </>
            )}

            <DropdownMenuSeparator />

            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                Theme
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as 'system' | 'light' | 'dark')}>
                  <DropdownMenuRadioItem value="system">
                    System
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="light">
                    Light
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dark">
                    Dark
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuItem
              onClick={() => setKeyboardShortcutsOpen(true)}
            >
              Keyboard shortcuts
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem
              onClick={() => router.push('/ycode/profile')}
            >
              My profile
            </DropdownMenuItem>

            <DropdownMenuItem
              onClick={async () => {
                await signOut();
              }}
            >
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex gap-1">
          {isEditor ? (
            <>
              <Button
                aria-label={rin5Navigation ? 'Canvas' : 'Content editor'}
                variant={(activeNavButton === 'design' && editorSidebarTab !== 'pages') ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => {
                  setOptimisticNav('design');
                  setActiveSidebarTab('layers');
                  if (lastDesignUrl) {
                    router.push(lastDesignUrl);
                  } else {
                    const targetPageId = storeCurrentPageId || findHomepage(storePages)?.id || storePages[0]?.id;
                    if (targetPageId) {
                      navigateToLayers(targetPageId);
                    }
                  }
                }}
              >
                <Icon name="pencil" />
                <span className="hidden lg:inline">{rin5Navigation ? 'Canvas' : 'Content editor'}</span>
              </Button>
              <Button
                aria-label="Pages"
                variant={editorSidebarTab === 'pages' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => {
                  setActiveSidebarTab('pages');
                  const targetPageId = storeCurrentPageId || findHomepage(storePages)?.id || storePages[0]?.id;
                  if (targetPageId) {
                    navigateToLayers(targetPageId);
                  }
                }}
              >
                <Icon name="page" />
                <span className="hidden lg:inline">Pages</span>
              </Button>
            </>
          ) : (
            <Button
              variant={activeNavButton === 'design' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => {
                setOptimisticNav('design');
                setActiveSidebarTab('layers');
                if (lastDesignUrl) {
                  router.push(lastDesignUrl);
                } else {
                  const targetPageId = storeCurrentPageId || findHomepage(storePages)?.id || storePages[0]?.id;
                  if (targetPageId) {
                    navigateToLayers(targetPageId);
                  }
                }
              }}
            >
              <Icon name="cursor-default" />
              Design
            </Button>
          )}
          <Button
            aria-label={isEditor && rin5Navigation ? 'Contenido' : 'CMS'}
            variant={activeNavButton === 'cms' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => {
              const isDesignRoute = routeType === 'layers' || routeType === 'page' || routeType === 'component';
              if (isDesignRoute) {
                setLastDesignUrl(window.location.pathname + window.location.search);
              }
              setOptimisticNav('cms');
              setActiveSidebarTab('cms');
              const targetCollectionId = storeSelectedCollectionId || collections[0]?.id;
              if (targetCollectionId) {
                setSelectedCollectionId(targetCollectionId);
                navigateToCollection(targetCollectionId);
              } else {
                navigateToCollections();
              }
            }}
          >
            <Icon name="database" />
            <span className="hidden lg:inline">{isEditor && rin5Navigation ? 'Contenido' : 'CMS'}</span>
          </Button>
          <Rin5CustomerLocalizationNav
            active={activeNavButton === 'localization'}
            enabled={isEditor && rin5Navigation !== null}
            onSelect={() => {
              const isDesignRoute = routeType === 'layers' || routeType === 'page' || routeType === 'component';
              if (isDesignRoute) {
                setLastDesignUrl(window.location.pathname + window.location.search);
              }
              setOptimisticNav('localization');
              router.push('/ycode/localization');
            }}
          />
          {isEditor && rin5Navigation && (
            <>
              <Button
                size="sm"
                variant="ghost"
                asChild
              >
                <a href={rin5Navigation.analyticsUrl}>Estadísticas</a>
              </Button>
              <Button
                size="sm"
                variant={routeType === 'site-settings' ? 'secondary' : 'ghost'}
                asChild
              >
                <a href={rin5Navigation.settingsUrl}>Ajustes</a>
              </Button>
            </>
          )}
          {!isEditor && (
            <Button
              variant={activeNavButton === 'forms' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => {
                const isDesignRoute = routeType === 'layers' || routeType === 'page' || routeType === 'component';
                if (isDesignRoute) {
                  setLastDesignUrl(window.location.pathname + window.location.search);
                }
                setOptimisticNav('forms');
                router.push('/ycode/forms');
              }}
            >
              <Icon name="form" />
              Forms
            </Button>
          )}
        </div>
      </div>

      <div className="hidden min-w-0 items-center justify-center gap-1.5 md:flex">
        <LocaleSelector />

        <div className="h-5">
          <Separator orientation="vertical" />
        </div>

        <Button
          size="xs"
          variant="ghost"
          asChild
        >
          <a
            href={baseUrl + publishedUrl} target="_blank"
            rel="noopener noreferrer"
          >
            {baseUrl}
          </a>
        </Button>

      </div>

      {/* Right: User & Actions */}
      <div className="flex min-w-0 items-center justify-end gap-1 md:gap-2">
        {isEditor && rin5Navigation && (
          <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className="md:hidden"
                size="xs"
                variant="ghost"
              >
                rin5
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {[
                ['Publicar', rin5Navigation.publishUrl],
                ['Ayuda', rin5Navigation.helpUrl],
              ].map(([label, href]) => (
                <DropdownMenuItem key={href} asChild>
                  <a href={href}>
                    {label}
                  </a>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <nav aria-label="rin5" className="hidden items-center gap-1 md:flex">
            {[
              ['Publicar', rin5Navigation.publishUrl],
              ['Ayuda', rin5Navigation.helpUrl],
            ].map(([label, href]) => (
              <Button
                key={href}
                size="xs"
                variant="ghost"
                asChild
              >
                <a href={href}>
                  {label}
                </a>
              </Button>
            ))}
          </nav>
          </>
        )}

        {/* Active Users */}
        <div className="hidden md:block"><ActiveUsersInHeader /></div>

        {/* Invite User */}
        {canManageMembers && <InviteUserButton />}

        {/* Save Status Indicator */}
        <div className="hidden w-16 items-center justify-end text-xs text-zinc-500 dark:text-white/50 sm:flex">
          {isSaving ? (
            <>
              <span>Saving</span>
            </>
          ) : hasUnsavedChanges ? (
            <>
              <span>Unsaved</span>
            </>
          ) : lastSaved ? (
            <>
              <span>Saved</span>
            </>
          ) : (
            <>
              <span>Ready</span>
            </>
          )}
        </div>

        {/* Preview button */}
        <Button
          size="sm"
          variant="secondary"
          onClick={handleTogglePreview}
          disabled={!currentPage || isSaving}
          className={isPreviewMode ? 'bg-black text-white hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90' : ''}
        >
          <Icon name="preview" />
        </Button>

        {canManageSettings && (
          <PublishPopover
            isPublishing={isPublishing}
            setIsPublishing={setIsPublishing}
            baseUrl={baseUrl}
            publishedUrl={publishedUrl}
            onPublishSuccess={onPublishSuccess}
          />
        )}

      </div>
    </header>

    <BackupRestoreDialog
      open={showTransferDialog}
      onOpenChange={setShowTransferDialog}
    />
    </>
  );
}
