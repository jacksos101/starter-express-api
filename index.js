require('dotenv').config();

const https = require('https');
const express = require('express');
const xml2js = require('xml2js');
const stripHtml = require('string-strip-html')

const token = process.env.SHOPIFY_ACCESS_TOKEN;
const PRODUCTS_PER_REQUEST = 250;
const DISPLAY_WAS_NOW_PRICING = false // should Facebook display RRP vs price, or just the price?

const app = express();

app.disable('etag');

app.all('/omnivore-fb-feed', async (req, res) => {

    res.set({
        'Content-Type': 'application/xml;charset=utf-8'
    });
    
    res.send(await buildFacebookFeed());
    
});

app.all('/omnivore-google-feed', async (req, res) => {
    
    res.set({
        'Content-Type': 'application/xml;charset=utf-8'
    });

    res.send(await buildGoogleFeed());

});

app.all('/shopify-feed', async (req, res) => {

    res.set({'Content-Type': 'application/json;charset=utf-8'})

    res.send(await fetchAllShopifyProducts());

});

app.listen(process.env.PORT || 3000);

// ------------------

// Retrieve Google feed from Omnivore, correct all URLs and remove shipping information
async function buildGoogleFeed(){

    let originalXML = await fetchOmnivoreGoogle();

    let parser = new xml2js.Parser();

    let parsedData = await parser.parseStringPromise(originalXML);

    let products = parsedData.rss.channel[0].item;

    products.forEach(p => {

        if(p['g:shipping']) delete p['g:shipping']; // remove all shipping information

        p['link'][0] = p['link'][0].replace('persian-rug-gallery-8881.myshopify.com', 'persianruggallery.co.nz'); // replace old URL if present

        // If product is not machine made, remove gtin and mpn fields, and tell Google that no product code exists
        console.log(p['g:product_type']);
        if(!p['g:product_type'][0].includes('Machine')){
            if(p['g:gtin']) delete p['g:gtin'];
            if(p['g:mpn']) delete p['g:mpn'];
            p['identifier_exists'] = false;
        }

    });

    parsedData.rss.channel[0].item = products;

    const builder = new xml2js.Builder({cdata: true});

    const xml = builder.buildObject(parsedData);

    return xml;
    
}


// Retrieve product feed from Omnivore, retrieve product prices from Shopify, and 
// replace the Omnivore prices with the correct prices. Return the corrected XML.
async function buildFacebookFeed(){

    let productPrices = processShopifyProductList(await fetchAllShopifyProducts());

    let originalXML = await fetchOmnivoreFacebook();

    let parsedItems;

    const parser = new xml2js.Parser();

    let result = await parser.parseStringPromise(originalXML);

    parsedItems = result.rss.channel[0].item;

    // Items that have been removed from shopify, but are still on the Omnivore feed
    let staleItems = [];

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
            } else {
                if(i['g:sale_price']) delete i['g:sale_price'];
            }
        }
        else {
            // If the product is not active on the Shopify API, it should be removed from the XML
            staleItems.push(i);
        }
        
        // Strip HTML from description
        //i['description'][0] = stripHtml.stripHtml(i['description'][0]).result;

        // Append query parameter 'ref=fbcommerce' to the link
        i['link'][0] = i['link'][0] += '?ref=metacommerce';

    });

    // Remove stale items from the array
    staleItems.forEach(i => {
        let index = parsedItems.indexOf(i);
        parsedItems.splice(index, 1);
    });

    const builder = new xml2js.Builder({cdata: true});

    result.rss.channel[0].item = parsedItems;

    const xml = builder.buildObject(result);

    return xml;

}

// Return the correct prices for the supplied product
function retrievePrices(priceList, productId){
    let product = priceList.find(p => p.id == productId);

    if(!product) return false;

    if(product.status != 'active' || product.inventory == 0) return false;

    return DISPLAY_WAS_NOW_PRICING ? 
    {
        price: product.compare_at_price || product.price,
        sale_price: product.compare_at_price ? product.price : undefined
    } : 
    { 
        price: product.price
    }
}

// Retrieve the XML document from Omnivore, containing products to be listted on Facebook.
async function fetchOmnivoreFacebook() {
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


// Retrieve XML document from Omnivore, containing products to be listted on Google.
async function fetchOmnivoreGoogle() {
    return new Promise((resolve, reject) => {

        const options = {
            host: `m1.omnivore.com.au`,
            path: `/v1/retailers/persian-rug-gallery-8881/products/googleads?secret=evaq4lluSA&type=xml`    }
    
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
async function fetchAllShopifyProducts(){

    let parsedProducts = [];
    let productResponse = {};

    do{
        productResponse = await fetchShopifyProducts(productResponse.nextLink);
        parsedProducts.push(...productResponse.products)
    }
    while(productResponse.nextLink)    

    
    
    return new Promise((resolve, reject) => {

        resolve(parsedProducts);

    });

};

// GET request to Shopify to fetch product details. Max 250 records per request
async function fetchShopifyProducts(nextLink){

    return new Promise((resolve, reject) => {

        const options = {
            host: `persian-rug-gallery-8881.myshopify.com`,
            path: `/admin/api/2022-10/products.json?limit=${PRODUCTS_PER_REQUEST}&fields=id,title,status,variants${nextLink ? `&${nextLink}` : ``}`,
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': token
            }
        }

        let data = '';
        
        https.get(options, response => {    

            let linkHeader = response.headers['link'];
            const match = linkHeader.match(/page_info=\w+/g);
            const hasNext = !!linkHeader.match(/next/);

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
function processShopifyProductList(products){

    return products.map(function(p){
          
        return p.variants.length > 1 ? p.variants.map(function(v){
            return {
                id: v.id,
                title: p.title,
                price: v.price,
                compare_at_price: v.compare_at_price,
                status: p.status,
                inventory: v.inventory_quantity
            }
        }) : {
            id: p.id,
            title: p.title,
            price: p.variants[0].price,
            compare_at_price: p.variants[0].compare_at_price,
            status: p.status,
            inventory: p.variants[0].inventory_quantity
        }
    
    }).flatMap(p => p);
}