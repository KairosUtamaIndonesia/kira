import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Section } from '@astryxdesign/core/Section';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { importVSCodeTheme, useKiraAppearance } from '@kira/theme';
import { useRef, useState, type ChangeEvent } from 'react';
import type { VSCodeThemeExtension, VSCodeThemePackageItem } from '../../preload/bridge';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not import this theme.';
}

function importedTheme(item: VSCodeThemePackageItem, extension: VSCodeThemeExtension) {
  if (item.error) throw new Error('This theme file could not be read from the package.');
  const imported = importVSCodeTheme(item.text, item.path);
  return {
    ...imported,
    name: item.name,
    author: imported.author ?? extension.namespace,
  };
}

export function AppearanceSection() {
  const appearance = useKiraAppearance();
  const fileInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<VSCodeThemeExtension[]>([]);
  const [packageExtension, setPackageExtension] = useState<VSCodeThemeExtension | null>(null);
  const [packageThemes, setPackageThemes] = useState<VSCodeThemePackageItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const lightOptions = [
    { value: '', label: 'OpenChamber default' },
    ...appearance.preferences.themes
      .filter((theme) => theme.variant === 'light')
      .map((theme) => ({
        value: theme.id,
        label: theme.author ? `${theme.name} · ${theme.author}` : theme.name,
      })),
  ];
  const darkOptions = [
    { value: '', label: 'OpenChamber default' },
    ...appearance.preferences.themes
      .filter((theme) => theme.variant === 'dark')
      .map((theme) => ({
        value: theme.id,
        label: theme.author ? `${theme.name} · ${theme.author}` : theme.name,
      })),
  ];

  async function importLocalFile(file: File): Promise<void> {
    setProblem(null);
    try {
      appearance.importTheme(importVSCodeTheme(await file.text(), file.name));
    } catch (error) {
      setProblem(errorText(error));
    }
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) void importLocalFile(file);
  }

  async function searchCatalog(): Promise<void> {
    setBusy(true);
    setProblem(null);
    setPackageExtension(null);
    setPackageThemes([]);
    const result = await window.kira.searchVSCodeThemes(query);
    setBusy(false);
    if (!result.ok) {
      setResults([]);
      setProblem(result.error);
      return;
    }
    setResults(result.value);
  }

  async function loadPackage(extension: VSCodeThemeExtension): Promise<void> {
    setBusy(true);
    setProblem(null);
    setPackageExtension(extension);
    setPackageThemes([]);
    const result = await window.kira.readVSCodeThemePackage(extension);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.error);
      return;
    }
    setPackageThemes(result.value);
  }

  function importCatalogTheme(item: VSCodeThemePackageItem): void {
    if (!packageExtension) return;
    setProblem(null);
    try {
      appearance.importTheme(importedTheme(item, packageExtension));
    } catch (error) {
      setProblem(errorText(error));
    }
  }

  return (
    <>
      <VStack gap={1}>
        <Heading level={2}>Appearance</Heading>
        <Text color="secondary" size="sm">
          Use OpenChamber’s warm light and dark themes, or import a VS Code color theme for this
          device.
        </Text>
      </VStack>

      <Section padding={4}>
        <VStack gap={3}>
          <Heading level={2}>Color themes</Heading>
          <Text color="secondary" size="sm">
            Choose light and dark variants separately. Kira follows your system appearance and uses
            the matching choice.
          </Text>
          <Selector
            label="Light theme"
            options={lightOptions}
            value={appearance.preferences.lightThemeId ?? ''}
            onChange={(id) => appearance.chooseTheme('light', id || null)}
          />
          <Selector
            label="Dark theme"
            options={darkOptions}
            value={appearance.preferences.darkThemeId ?? ''}
            onChange={(id) => appearance.chooseTheme('dark', id || null)}
          />
          <Text color="secondary" size="sm">
            Currently showing the {appearance.mode} theme
            {appearance.activeTheme
              ? ` · ${appearance.activeTheme.name}`
              : ' · OpenChamber default'}
            .
          </Text>
        </VStack>
      </Section>

      <Section padding={4}>
        <VStack gap={3}>
          <Heading level={2}>Import a VS Code theme</Heading>
          <Text color="secondary" size="sm">
            Import a standalone .json or .jsonc color theme. Imported themes and selections stay on
            this device.
          </Text>
          <HStack gap={2}>
            <Button
              label="Choose theme file"
              variant="ghost"
              size="sm"
              isDisabled={busy}
              onClick={() => fileInput.current?.click()}
            />
            <input
              ref={fileInput}
              type="file"
              accept=".json,.jsonc,application/json"
              hidden
              onChange={chooseFile}
            />
          </HStack>
        </VStack>
      </Section>

      <Section padding={4}>
        <VStack gap={3}>
          <Heading level={2}>Find a theme on Open VSX</Heading>
          <Text color="secondary" size="sm">
            Search the Open VSX theme catalog. Themes published only on Microsoft Marketplace may
            not appear.
          </Text>
          <HStack align="end" gap={2}>
            <TextInput
              label="Search Open VSX"
              value={query}
              onChange={setQuery}
              placeholder="For example, Tokyo Night"
              size="sm"
            />
            <Button
              label={busy ? 'Searching…' : 'Search'}
              variant="primary"
              size="sm"
              isDisabled={busy || query.trim().length === 0}
              onClick={() => void searchCatalog()}
            />
          </HStack>

          {results.length === 0 ? null : (
            <VStack gap={1}>
              {results.map((extension) => (
                <HStack
                  key={`${extension.namespace}/${extension.name}/${extension.version}`}
                  justify="between"
                  align="center"
                >
                  <VStack gap={0.5}>
                    <Text weight="bold" size="sm">
                      {extension.label}
                    </Text>
                    <Text color="secondary" size="sm">
                      {extension.namespace}/{extension.name}
                    </Text>
                  </VStack>
                  <Button
                    label={
                      packageExtension?.name === extension.name &&
                      packageExtension.namespace === extension.namespace
                        ? 'Reload variants'
                        : 'View variants'
                    }
                    variant="ghost"
                    size="sm"
                    isDisabled={busy}
                    onClick={() => void loadPackage(extension)}
                  />
                </HStack>
              ))}
            </VStack>
          )}

          {packageExtension === null || packageThemes.length === 0 ? null : (
            <VStack gap={1}>
              <Text weight="bold" size="sm">
                {packageExtension.label} themes
              </Text>
              {packageThemes.map((item) => {
                let variant: 'light' | 'dark' | null = null;
                if (!item.error) {
                  try {
                    variant = importVSCodeTheme(item.text, item.path).variant;
                  } catch {
                    // The row below explains that an unsupported theme cannot be imported.
                  }
                }
                return (
                  <HStack
                    key={`${packageExtension.namespace}/${packageExtension.name}/${item.path}`}
                    justify="between"
                    align="center"
                  >
                    <VStack gap={0.5}>
                      <Text size="sm">{item.name}</Text>
                      {variant === null ? (
                        <Text color="secondary" size="sm">
                          Unsupported theme file
                        </Text>
                      ) : (
                        <Badge label={`${variant} theme`} variant="neutral" />
                      )}
                    </VStack>
                    <Button
                      label="Import"
                      variant="ghost"
                      size="sm"
                      isDisabled={busy || variant === null}
                      onClick={() => importCatalogTheme(item)}
                    />
                  </HStack>
                );
              })}
            </VStack>
          )}
        </VStack>
      </Section>

      {appearance.preferences.themes.length === 0 ? null : (
        <Section padding={4}>
          <VStack gap={3}>
            <Heading level={2}>Imported themes</Heading>
            {appearance.preferences.themes.map((theme) => (
              <HStack key={theme.id} justify="between" align="center">
                <VStack gap={0.5}>
                  <Text weight="bold" size="sm">
                    {theme.name}
                  </Text>
                  <Text color="secondary" size="sm">
                    {[theme.variant, theme.author].filter(Boolean).join(' · ')}
                  </Text>
                </VStack>
                <Button
                  label="Remove"
                  variant="ghost"
                  size="sm"
                  onClick={() => appearance.removeTheme(theme.id)}
                />
              </HStack>
            ))}
          </VStack>
        </Section>
      )}

      {problem === null ? null : (
        <Text color="secondary" size="sm" role="alert">
          {problem}
        </Text>
      )}
    </>
  );
}
