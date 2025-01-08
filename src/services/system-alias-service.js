const fs = require('fs');
const path = require('path');

class SystemAliasService {
    constructor() {
        this.aliasMap = new Map();
        this.aliasFile = path.join('data', 'system-alias.csv');
        this.ensureAliasFile();
        this.loadAliases();
        this.setupFileWatcher();
    }

    setupFileWatcher() {
        const dir = path.dirname(this.aliasFile);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.watch(this.aliasFile, (eventType) => {
            if (eventType === 'change') {
                console.log('System alias file changed, reloading...');
                this.loadAliases();
                // Notify any registered listeners
                if (this.onAliasesChanged) {
                    this.onAliasesChanged();
                }
            }
        });

        // Also watch the directory for file creation
        fs.watch(dir, (eventType, filename) => {
            if (filename === 'system-alias.csv' && !fs.existsSync(this.aliasFile)) {
                console.log('System alias file created, ensuring defaults...');
                this.ensureAliasFile();
                this.loadAliases();
                if (this.onAliasesChanged) {
                    this.onAliasesChanged();
                }
            }
        });
    }

    // Register a callback for alias changes
    onAliasChange(callback) {
        this.onAliasesChanged = callback;
    }

    ensureAliasFile() {
        const dir = path.dirname(this.aliasFile);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        // Only create the file if it doesn't exist
        if (!fs.existsSync(this.aliasFile)) {
            console.log('Creating new system alias file with default header');
            fs.writeFileSync(this.aliasFile, 'shortName,alias\n', 'utf-8');
        } else {
            console.log('System alias file already exists, preserving content');
        }
    }

    loadAliases() {
        try {
            const content = fs.readFileSync(this.aliasFile, 'utf-8');
            const lines = content.split('\n').filter(line => line.trim());
            
            // Clear existing aliases before loading
            this.aliasMap.clear();
            
            // Skip header if present
            const dataLines = lines[0].toLowerCase().includes('shortname,alias') ? lines.slice(1) : lines;
            
            dataLines.forEach(line => {
                const [shortName, alias] = line.split(',').map(s => s.trim());
                if (shortName && alias) {
                    this.aliasMap.set(shortName, alias);
                }
            });
            
            console.log(`Loaded ${this.aliasMap.size} system aliases from ${this.aliasFile}`);
        } catch (error) {
            console.error('Error loading system aliases:', error);
        }
    }

    async saveAliases() {
        try {
            const lines = ['shortName,alias'];
            for (const [shortName, alias] of this.aliasMap.entries()) {
                lines.push(`${shortName},${alias}`);
            }
            await fs.promises.writeFile(this.aliasFile, lines.join('\n'), 'utf-8');
        } catch (error) {
            console.error('Error saving system aliases:', error);
        }
    }

    getAlias(shortName) {
        return this.aliasMap.get(shortName) || this.generateDefaultAlias(shortName);
    }

    generateDefaultAlias(shortName) {
        // Convert e.g., "butco" to "Butler"
        return shortName
            .replace(/co$/, '') // Remove 'co' suffix
            .split(/[_-]/) // Split on underscore or hyphen
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
    }

    async addSystem(shortName) {
        // Only add if system doesn't exist in the alias map
        if (!this.aliasMap.has(shortName)) {
            console.log(`Adding new system ${shortName} with generated alias`);
            const defaultAlias = this.generateDefaultAlias(shortName);
            this.aliasMap.set(shortName, defaultAlias);
            await this.saveAliases();
            return true;
        }
        console.log(`System ${shortName} already exists with alias: ${this.aliasMap.get(shortName)}`);
        return false;
    }

    async updateAlias(shortName, alias) {
        if (alias && alias.trim()) {
            const existingAlias = this.aliasMap.get(shortName);
            if (existingAlias !== alias.trim()) {
                console.log(`Updating alias for ${shortName}: ${existingAlias} -> ${alias.trim()}`);
                this.aliasMap.set(shortName, alias.trim());
                await this.saveAliases();
                return true;
            }
            console.log(`Alias for ${shortName} unchanged: ${existingAlias}`);
        }
        return false;
    }
}

module.exports = new SystemAliasService();
