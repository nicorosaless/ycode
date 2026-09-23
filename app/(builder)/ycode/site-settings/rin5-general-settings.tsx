'use client'

import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { Rin5Navigation } from '@/lib/rin5-navigation'
import { useSettingsStore } from '@/stores/useSettingsStore'

export default function Rin5GeneralSettings({ navigation }: { navigation: Rin5Navigation | null }) {
  const getSetting = useSettingsStore((state) => state.getSettingByKey)
  const updateSetting = useSettingsStore((state) => state.updateSetting)
  const [siteName, setSiteName] = useState(() => String(getSetting('site_name') || ''))
  const [description, setDescription] = useState(() => String(getSetting('site_description') || ''))
  const [timezone, setTimezone] = useState(() => String(getSetting('timezone') || 'Europe/Madrid'))
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      const response = await fetch('/ycode/api/rin5/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_name: siteName, site_description: description, timezone }),
      })
      if (!response.ok) throw new Error('No se pudieron guardar los ajustes')
      const saved = (await response.json()).data
      Object.entries(saved).forEach(([key, value]) => updateSetting(key, value))
      toast.success('Ajustes guardados')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron guardar los ajustes')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="flex-1 overflow-y-auto p-8">
      <div className="mx-auto max-w-2xl space-y-8">
        <header>
          <h1 className="text-xl font-semibold">Ajustes generales</h1>
          <p className="mt-1 text-sm text-muted-foreground">Información básica y zona horaria de tu web.</p>
        </header>
        <div className="space-y-6 rounded-lg border bg-card p-6">
          <Field>
            <FieldLabel htmlFor="site-name">Nombre de la web</FieldLabel>
            <Input
              id="site-name"
              value={siteName}
              onChange={(event) => setSiteName(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="site-description">Descripción</FieldLabel>
            <Textarea
              id="site-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={500}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="timezone">Zona horaria</FieldLabel>
            <Input
              id="timezone"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
            />
            <FieldDescription>Usa una zona IANA, por ejemplo Europe/Madrid.</FieldDescription>
          </Field>
          <Button onClick={save} disabled={saving || !siteName.trim()}>{saving ? 'Guardando…' : 'Guardar cambios'}</Button>
        </div>
        {navigation && (
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" asChild><a href={navigation.siteUrl + '/domain'}>Dominio</a></Button>
            <Button variant="outline" asChild><a href={navigation.siteUrl}>Plan y facturación</a></Button>
          </div>
        )}
      </div>
    </main>
  )
}
