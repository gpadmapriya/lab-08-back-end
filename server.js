'use strict';

// Load Environment Variables from the .env file
require('dotenv').config();

// Application Dependencies
const express = require('express');
const cors = require('cors');
const superagent = require('superagent');
const pg = require('pg');

//Global variable
const PORT = process.env.PORT || 3000;

//Instantiate a new PG client using the database credentials from the .env file
const client = new pg.Client(process.env.DATABASE_URL);
//Connect to the client
client.connect();
client.on('error', error => {
  console.error(error);
})


// Application Setup
const app = express();
app.use(cors());

// Listen for /location route. Return a 500 status if there are errors in getting data
// Call searchToLatLong function with location entered
app.get('/location', searchToLatLong);

// Listen for /weather route. Return a 500 status if there are errors in getting data
// Call searchForWeather function to get weather data for the location
app.get('/weather', searchForWeather);

// Listen for /events route. Return a 500 status if there are errors in getting data
// Call searchForEvents function to get event data for the location
app.get('/events', searchForEvents);

// Catch and respond to routes other than the ones defined
app.use('*', (request, response) => {
  response.send('you got to the wrong place');
})

// Helper Functions

// Making a request to Google's geocode API and getting back a location object with coordinates
function searchToLatLong(request, response) {


  const locationName = request.query.data;
  const query = 'SELECT * FROM locations WHERE search_query=';
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${locationName}&key=${process.env.GEOCODE_API_KEY}`;
  const origin = 'locations';
  lookUp(origin, locationName, query, url, response);
}

// Refactor the searchToLatLong function to replace the object literal with a call to this constructor function:
function Location(query, result) {
  this.search_query = query;
  this.formatted_query = result.body.results[0].formatted_address;
  this.latitude = result.body.results[0].geometry.location.lat;
  this.longitude = result.body.results[0].geometry.location.lng;
}

//The searchForWeather function returns an array with the day and the forecast for the day. Refactor to use map method.
//Calls the Darksky API to get weather information for the location
function searchForWeather(request, response) {

  const location = request.query.data;
  const query = 'SELECT * FROM weathers WHERE location_name=';

  const url = `https://api.darksky.net/forecast/${process.env.WEATHER_API_KEY}/${location.latitude},${location.longitude}`;

  const origin = 'weathers';

  lookUp(origin, location, query, url, response);


}

//Constructor function to create weather objects
function Weather(weatherData) {
  let time = new Date(weatherData.time * 1000).toDateString();
  this.forecast = weatherData.summary;
  this.time = time;
}

//Makes an API call to Eventbrite to get events for the location
function searchForEvents(request, response) {
  const location = request.query.data;
  const url = `https://www.eventbriteapi.com/v3/events/search/?location.longitude=${location.longitude}&location.latitude=${location.latitude}&expand=venue&token=${process.env.EVENTBRITE_API_KEY}`;
  superagent.get(url)
    .then(result => {
      const eventArr = result.body.events.map(eventData => {
        return new Event(eventData);
      })
      response.send(eventArr);
    })
    .catch(e => {
      console.error(e);
      response.status(500).send('Status 500: I broke trying to get weather.')
    })
}

//Constructor function to create event objects
function Event(eventData) {
  this.link = eventData.url;
  this.name = eventData.name.text;
  this.event_date = new Date(eventData.start.utc).toDateString();
  this.summary = eventData.summary;
}

function lookUp(origin, locationName, searchQuery, url, response) {

  const formatQuery = searchQuery + '\'' + locationName + '\'';

  client.query(formatQuery).then(sqlResult => {
    if (sqlResult.rowCount === 0) {
      if (origin === 'locations') {
        insertIntoLocation(locationName, response, url);
      } else if (origin === 'weathers') {
        insertIntoWeather(locationName, response, url);
      }
    } else {
      if (origin === 'locations') {
        response.send(sqlResult.rows[0]);
      } else if (origin === 'weathers') {
        //console.log('weathers');
        //Need to create an array of forecast items from weathers table to pass back when record exists in db
      }
    }
  });

}

function insertIntoLocation(locationName, response, url) {
  superagent.get(url)
    .then(result => {

      let location = new Location(locationName, result)

      // Save the data to postgres
      // client.query takes two arguments: a sql command, and an array ov values
      client.query(
        `INSERT INTO locations (
    search_query,
    formatted_query,
    latitude,
    longitude
  ) VALUES ($1, $2, $3, $4)`,
        [location.search_query, location.formatted_query, location.latitude, location.longitude]
      )
      response.send(location);

    }).catch(e => {
      console.error(e);
      response.status(500).send('Status 500: So sorry i broke');
    })
}

function insertIntoWeather(locationName, response, url) {
  superagent.get(url)
    .then(result => {
      const weatherArr = result.body.daily.data.map(day => {
        return new Weather(day);
      })

      for (let i = 0; i < weatherArr.length; i++) {
        client.query(
          `INSERT INTO weathers (
      forecast,
      time,
      location_name
    ) VALUES ($1, $2, $3)`,
          [weatherArr[i].forecast, weatherArr[i].time, locationName]
        )
      }

      response.send(weatherArr);
    })
    .catch(e => {
      console.error(e);
      response.status(500).send('Status 500: I broke trying to get weather.')
    })
}

// Make sure the server is listening for requests
app.listen(PORT, () => console.log(`App is listening on ${PORT}`));