module.exports = {
  apps: [
    {
      name: "flashdrop",
      cwd: "/home/aks/flashdrop",
      script: "./node_modules/next/dist/bin/next",
      args: "start --hostname 0.0.0.0 --port 3005",
      interpreter: "/home/aks/.config/nvm/versions/node/v24.15.0/bin/node",
      autorestart: true,
      max_restarts: 20,
      restart_delay: 2000,
      watch: false,
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
