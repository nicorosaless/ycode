import { resolveRin5Navigation } from '@/lib/rin5-navigation'

import Rin5GeneralSettings from './rin5-general-settings'

export default function SiteSettingsPage() {
  const navigation = resolveRin5Navigation(process.env)
  return <Rin5GeneralSettings navigation={navigation} />
}
