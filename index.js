require('dotenv').config();

const https = require('https');
const express = require('express');
const xml2js = require('xml2js');
const stripHtml = require('string-strip-html')

const token = process.env.SHOPIFY_ACCESS_TOKEN;
const PRODUCTS_PER_REQUEST = 250;

const app = express();

app.disable('etag');

app.all('/omnivore-fb-feed', async (req, res) => {

    res.set({
        'Content-Type': 'application/xml;charset=utf-8'
    });
    
    res.send(await correctXMLPrices());
    
});

app.listen(process.env.PORT || 3000);

// ------------------
// Retrieve product feed from Omnivore, retrieve product prices from Shopify, and 
// replace the Omnivore prices with the correct prices. Return the corrected XML.
async function correctXMLPrices(){

    let productPrices = await buildPriceList();

    let originalXML = await fetchOmnivore();

    let parsedItems;

    const parser = new xml2js.Parser();

    let result = await parser.parseStringPromise(originalXML);

    parsedItems = result.rss.channel[0].item;

    parsedItems.forEach(i => {

        let prices = retrievePrices(productPrices, i['g:id'][0]);

        if(prices){
            if(prices.price) i['g:price'][0] = `${prices.price} NZD`;
            if(prices.sale_price) {
                if(i['g:sale_price']){
                    i['g:sale_price'][0] = `${prices.sale_price} NZD`
                } else {
                    i['g:sale_price'] = [`${prices.sale_price} NZD`]
                }
            }
        }
        
        i['description'][0] = stripHtml.stripHtml(i['description'][0]).result;

    });

    const builder = new xml2js.Builder();

    result.rss.channel[0].item = parsedItems;

    const xml = builder.buildObject(result);

    return xml;

}

// Return the correct prices for the supplied product
function retrievePrices(priceList, productId){
    let product = priceList.find(p => p.id == productId);

    if(!product) return false;

    return {
        price: product.compare_at_price || product.price,
        sale_price: product.compare_at_price ? product.price : undefined
    }
}

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

// Strip away unwanted fields leaving only the IDs and prices of the variants. 
// For items with a single variant, product ID will be retained. 
// For multi variant items, variant ID will be retained.
function mapList(products){

    return products.map(function(p){
          
        return p.variants.length > 1 ? p.variants.map(function(v){
            return {
                id: v.id,
                price: v.price,
                compare_at_price: v.compare_at_price
            }
        }) : {
            id: p.id,
            price: p.variants[0].price,
            compare_at_price: p.variants[0].compare_at_price
        }
    
    }).flatMap(p => p);
}