require('dotenv').config();

const path = require('path');
const express = require('express');
const compression = require('compression');
const expressHandlebars = require('express-handlebars');
const helmet = require('helmet');
const session = require('express-session');
const router = require('./router.js');

const port = process.env.PORT || process.env.NODE_PORT || 3000;

const app = express();

app.use(helmet.contentSecurityPolicy({
    directives: {
        defaultSrc:  ["'self'"],
        connectSrc:  ["'self'", "blob:"],
        imgSrc:      ["'self'", "blob:", "data:"],
        workerSrc:   ["'self'", "blob:"],
        scriptSrc:   ["'self'"],
        styleSrc:    ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        styleSrcElem:["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc:     ["'self'", "https://fonts.gstatic.com"],
    }
}));

app.use('/assets', express.static(path.resolve(`${__dirname}/../hosted`)));
app.use(compression());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    key: 'sessionid',
    secret: process.env.SESSION_SECRET || 'devSecret123',
    resave: false,
    saveUninitialized: false,
}));

app.engine('handlebars', expressHandlebars.engine({ defaultLayout: '' }));
app.set('view engine', 'handlebars');
app.set('views', `${__dirname}/../views`);

console.log(`dirname: ${__dirname}`);
router(app);

app.listen(port, (err) => {
    if (err) throw err;
    console.log(`Listening on port ${port}`);
});