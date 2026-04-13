import React, { useState, useEffect, useCallback } from 'react'

const { ipcRenderer } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')

const CONFIG_DIR = path.join(os.homedir(), '.sentinel')
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json')

interface SentinelUIConfig {
  githubOrg: string
  preferredAgent: 'claude-code' | 'openclaw' | 'manual-only'
  openclawUrl: string
  openclawApiKey: string
  repoPathMappings: Record<string, string>
  autoDispatch: {
    bugbot: boolean
    codeql: boolean
    ci: boolean
  }
  pollingInterval: 30 | 60 | 120
}

interface SettingsProps {
  onClose: () => void
}

const DEFAULT_CONFIG: SentinelUIConfig = {
  githubOrg: '',
  preferredAgent: 'claude-code',
  openclawUrl: 'http://localhost:4000',
  openclawApiKey: '',
  repoPathMappings: {},
  autoDispatch: { bugbot: false, codeql: false, ci: false },
  pollingInterval: 60,
}

function loadConfig(): SentinelUIConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
      return JSON.parse(raw)
    }
  } catch {
    // Fall through to defaults
  }
  return { ...DEFAULT_CONFIG }
}

async function fetchDaemonConfig(): Promise<Partial<SentinelUIConfig> | null> {
  try {
    const res = await fetch('http://localhost:3847/state/config')
    if (!res.ok) return null
    const data = await res.json()
    return {
      githubOrg: data.githubOrg || '',
      preferredAgent: data.preferredAgent || 'claude-code',
      openclawUrl: data.openclawUrl || 'http://localhost:4000',
      openclawApiKey: data.openclawApiKey || '',
      repoPathMappings: data.repoPaths || {},
      autoDispatch: {
        bugbot: data.autoDispatchBugbot ?? false,
        codeql: data.autoDispatchCodeql ?? false,
        ci: data.autoDispatchCI ?? false,
      },
    }
  } catch {
    return null
  }
}

function saveConfig(config: SentinelUIConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
}

async function loadPAT(): Promise<string> {
  try {
    const keytar = require('keytar')
    const pat = await keytar.getPassword('sentinel', 'github-pat')
    return pat ?? ''
  } catch {
    return ''
  }
}

async function savePAT(pat: string): Promise<void> {
  try {
    const keytar = require('keytar')
    if (pat) {
      await keytar.setPassword('sentinel', 'github-pat', pat)
    } else {
      await keytar.deletePassword('sentinel', 'github-pat')
    }
  } catch (err) {
    console.error('Failed to save PAT to keychain:', err)
  }
}

export function Settings({ onClose }: SettingsProps) {
  const [config, setConfig] = useState<SentinelUIConfig>(loadConfig)
  const [pat, setPat] = useState('')
  const [mappings, setMappings] = useState<Array<{ repo: string; path: string }>>(
    Object.entries(config.repoPathMappings).map(([repo, p]) => ({ repo, path: p }))
  )

  useEffect(() => {
    loadPAT().then(setPat)
    // Seed from daemon's .env config if no local config file exists
    if (!fs.existsSync(CONFIG_PATH)) {
      fetchDaemonConfig().then(daemonConfig => {
        if (daemonConfig) {
          const merged = { ...DEFAULT_CONFIG, ...daemonConfig }
          setConfig(merged)
          setMappings(Object.entries(merged.repoPathMappings).map(([repo, p]) => ({ repo, path: p })))
        }
      })
    }
  }, [])

  const handleSave = useCallback(async () => {
    const repoPathMappings: Record<string, string> = {}
    for (const m of mappings) {
      if (m.repo.trim() && m.path.trim()) {
        repoPathMappings[m.repo.trim()] = m.path.trim()
      }
    }

    const updatedConfig = { ...config, repoPathMappings }
    saveConfig(updatedConfig)
    await savePAT(pat)

    // Notify main process to reload config
    try {
      ipcRenderer.send('config-updated')
    } catch {
      // Non-critical
    }

    onClose()
  }, [config, pat, mappings, onClose])

  const addMapping = useCallback(() => {
    setMappings(prev => [...prev, { repo: '', path: '' }])
  }, [])

  const removeMapping = useCallback((index: number) => {
    setMappings(prev => prev.filter((_, i) => i !== index))
  }, [])

  const updateMapping = useCallback((index: number, field: 'repo' | 'path', value: string) => {
    setMappings(prev => prev.map((m, i) => i === index ? { ...m, [field]: value } : m))
  }, [])

  return (
    <div>
      <div className="header">
        {'\u2699'} Settings
      </div>
      <div className="settings-panel">
        <div className="settings-field">
          <label>GitHub PAT</label>
          <input
            type="password"
            value={pat}
            onChange={e => setPat(e.target.value)}
            placeholder="ghp_..."
          />
        </div>

        <div className="settings-field">
          <label>GitHub Org / Username</label>
          <input
            type="text"
            value={config.githubOrg}
            onChange={e => setConfig(prev => ({ ...prev, githubOrg: e.target.value }))}
            placeholder="your-org-or-username"
          />
        </div>

        <div className="settings-field">
          <label>Preferred Agent</label>
          <select
            value={config.preferredAgent}
            onChange={e => setConfig(prev => ({
              ...prev,
              preferredAgent: e.target.value as SentinelUIConfig['preferredAgent'],
            }))}
          >
            <option value="claude-code">Claude Code</option>
            <option value="openclaw">OpenClaw</option>
            <option value="manual-only">Manual Only</option>
          </select>
        </div>

        <div className="settings-field">
          <label>OpenClaw URL</label>
          <input
            type="text"
            value={config.openclawUrl}
            onChange={e => setConfig(prev => ({ ...prev, openclawUrl: e.target.value }))}
            placeholder="http://localhost:4000"
          />
        </div>

        <div className="settings-field">
          <label>OpenClaw API Key</label>
          <input
            type="password"
            value={config.openclawApiKey}
            onChange={e => setConfig(prev => ({ ...prev, openclawApiKey: e.target.value }))}
            placeholder="API key"
          />
        </div>

        <div className="settings-field">
          <label>Repo Path Mappings</label>
          {mappings.map((m, i) => (
            <div key={i} className="repo-mapping">
              <input
                type="text"
                value={m.repo}
                onChange={e => updateMapping(i, 'repo', e.target.value)}
                placeholder="owner/repo"
              />
              <input
                type="text"
                value={m.path}
                onChange={e => updateMapping(i, 'path', e.target.value)}
                placeholder="/absolute/local/path"
              />
              <button onClick={() => removeMapping(i)}>{'\u2715'}</button>
            </div>
          ))}
          <button className="add-mapping-btn" onClick={addMapping}>+ Add mapping</button>
        </div>

        <div className="settings-field">
          <label>Auto-Dispatch Rules</label>
          <div className="checkbox-group">
            <label>
              <input
                type="checkbox"
                checked={config.autoDispatch.bugbot}
                onChange={e => setConfig(prev => ({
                  ...prev,
                  autoDispatch: { ...prev.autoDispatch, bugbot: e.target.checked },
                }))}
              />
              BugBot findings
            </label>
            <label>
              <input
                type="checkbox"
                checked={config.autoDispatch.codeql}
                onChange={e => setConfig(prev => ({
                  ...prev,
                  autoDispatch: { ...prev.autoDispatch, codeql: e.target.checked },
                }))}
              />
              CodeQL alerts
            </label>
            <label>
              <input
                type="checkbox"
                checked={config.autoDispatch.ci}
                onChange={e => setConfig(prev => ({
                  ...prev,
                  autoDispatch: { ...prev.autoDispatch, ci: e.target.checked },
                }))}
              />
              CI failures
            </label>
          </div>
        </div>

        <div className="settings-field">
          <label>Polling Interval</label>
          <div className="radio-group">
            {([30, 60, 120] as const).map(val => (
              <label key={val}>
                <input
                  type="radio"
                  name="pollingInterval"
                  value={val}
                  checked={config.pollingInterval === val}
                  onChange={() => setConfig(prev => ({ ...prev, pollingInterval: val }))}
                />
                {val}s
              </label>
            ))}
          </div>
        </div>

        <div className="settings-actions">
          <button className="cancel-btn" onClick={onClose}>Cancel</button>
          <button className="save-btn" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  )
}
