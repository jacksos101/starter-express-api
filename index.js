const https = require('https');
const express = require('express');

const token = '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';
const PRODUCTS_PER_REQUEST = 250;

const app = express();

app.disable('etag');

app.all('/', async (req, res) => {

    res.set({
        'Content-Type': 'application/json;charset=utf-8'
    });
    
    res.send(await buildPriceList());
    
});

app.listen(process.env.PORT || 3000);

// ------------------

// Retrieve the XML document from Omnivore, containing products to be listted on Facebook.
async function fetchOmnivore() {
    return new Promise((resolve, reject) => {

        const options = {
            host: `m1.omnivore.com.au`,
            path: `/v1/retailers/persian-rug-gallery-8881/products/facebook?secret=3O4vOvGpmvBo0lqE1P9D`    }
    
        let data = '';
        
        https.get(options, response => {    
            response
                .on('data', chunk => data += chunk)
                .on('end', () => resolve(data))
                .on('error', error => reject(error));
        });

    });
}


// Returns json object of all products - IDs, variants, and prices - compare-with price, if applicable
async function buildPriceList(){

    let parsedProducts = [];
    let productResponse = {};

    do{
        productResponse = await fetchProducts(productResponse.nextLink);
        parsedProducts.push(...productResponse.products)
    }
    while(productResponse.nextLink)    

    
    
    return new Promise((resolve, reject) => {

        resolve(mapList(parsedProducts));

    });

};

// GET request to Shopify to fetch product details. Max 250 records per request
async function fetchProducts(nextLink){

    return new Promise((resolve, reject) => {

        const options = {
            host: `persian-rug-gallery-8881.myshopify.com`,
            path: `/admin/api/2022-10/products.json?limit=${PRODUCTS_PER_REQUEST}&fields=id,variants${nextLink ? `&${nextLink}` : ``}`,
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': token
            }
        }

        let data = '';
        
        https.get(options, response => {    

            let linkHeader = response.headers['link'];
            const match = linkHeader.match(/page_info=\w+/g);
            const hasNext = linkHeader.match(/next/);

            let nextLink = hasNext && match ? match[match.length-1] : false;

            response
                .on('data', chunk => data += chunk)
                .on('end', () => resolve({products: parseProducts(data), nextLink: nextLink})) 
                .on('error', error => reject(error));
        });
    });

}

// Parse JSON string into object, return ID of last product if product count == 250
var parseProducts = (json) => JSON.parse(json).products;

// Strip away unwanted fields leaving only the IDs and prices of the variants
function mapList(products){

    return products.map(function(p){
          
        return p.variants.map(function(v){
            return {
                id: v.id,
                price: v.price,
                compare_at_price: v.compare_at_price
            }
        })
    
    }).flatMap(p => p);
}