const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

app.get('/health', (_req, res) => res.status(200).send('OK'));

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
