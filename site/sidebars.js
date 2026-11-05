/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  guides: [
    'index',
    {
      type: 'category', label: 'Start', collapsed: false,
      items: ['start/overview', 'start/install', 'start/example-data'],
    },
    {
      type: 'category', label: 'Use PantryPal',
      items: ['use/pantry', 'use/recipes', 'use/meal-plans', 'use/shopping', 'use/dietary-rules'],
    },
    {
      type: 'category', label: 'Connect an AI assistant',
      items: ['connect/setup', 'connect/tasks', 'reference/mcp-tools'],
    },
    {
      type: 'category', label: 'Host PantryPal',
      items: ['host/configuration', 'host/security', 'host/tunnel', 'host/backups', 'host/updates', 'host/troubleshooting'],
    },
    {
      type: 'category', label: 'Develop and contribute',
      items: ['develop/setup', 'develop/checks', 'develop/architecture', 'develop/contributing', 'develop/documentation'],
    },
    {
      type: 'category', label: 'Reference',
      items: ['reference/rest-api', 'reference/cli', 'reference/import', 'reference/import-format'],
    },
  ],
};

export default sidebars;
