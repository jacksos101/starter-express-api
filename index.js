const https = require('https');
const express = require('express');

const app = express();

app.disable('etag');

app.all('/', (req, res) => {

    const options = {
        host: `m1.omnivore.com.au`,
        path: `/v1/retailers/persian-rug-gallery-8881/products/facebook?secret=3O4vOvGpmvBo0lqE1P9D`
    }

    let data = '';
    
    https.get(options, response => {    
        response
            .on('data', chunk => data += chunk)
            .on('end', () => {                
                res.set({
                    'Content-Type': 'text/xml;charset=utf-8'
                });
                res.send(data);
            })
            .on('error', error => res.send(error));
    });
});

app.listen(process.env.PORT || 3000);