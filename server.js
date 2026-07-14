const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// 显式处理根路径
app.get('/', (_req, res) => {
    const htmlPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(htmlPath)) {
        res.sendFile(htmlPath);
    } else {
        res.send('<h1>508 Dorm</h1>');
    }
});

app.get('/health', (_req, res) => res.status(200).send('OK'));

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, '0.0.0.0', () => {
    console.log('Server running on port ' + PORT);
    console.log('CWD:', process.cwd());
    console.log('__dirname:', __dirname);
});
