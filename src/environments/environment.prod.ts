// Utilisé en build `production` via fileReplacements (angular.json). apiUrl relatif :
// en déploiement standalone (Docker nginx de ce repo), nginx.conf proxifie /api/collaboratif
// vers le backend. Une fois intégré comme lazy-loaded dans le shell pivot-ui, c'est le nginx
// du shell qui route /api/collaboratif/ (voir pivot-docs/docs/architecture/platform-overview.md).
export const environment = {
  production: true,
  apiUrl: '/api/collaboratif',
};
