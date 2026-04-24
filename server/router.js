const controllers = require('./controllers');

const router = (app) => {
    // Main page — serves the 3D viewer
    app.get('/', controllers.Loader.loadPage);

    // Future routes (login, API, etc.)
};

module.exports = router;
